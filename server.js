require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const session = require('express-session');
const path = require('path');

// Firebase Admin Modular Import with cert
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();

// Initialize Firebase Admin safely using Service Account JSON from Environment Variable
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({
        credential: cert(serviceAccount)
    });
}
const db = getFirestore();

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'dashpulse_secret_key',
    resave: false,
    saveUninitialized: true
}));

// Serve Static Frontend
app.use(express.static(path.join(__dirname, 'public')));

// Google OAuth Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// Auth Route with Expanded Scopes
app.get('/auth/google', (req, res) => {
    const scopes = [
        // User Profile Info
        'https://www.googleapis.com/auth/userinfo.email',

        // Gmail Scopes
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',

        // Google Photos Scope
        'https://www.googleapis.com/auth/photoslibrary.readonly',

        // Google Drive & Docs Scopes
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/documents',

        // Google Calendar Scope
        'https://www.googleapis.com/auth/calendar.events'
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes
    });

    res.redirect(url);
});

// OAuth Callback Route
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const userEmail = userInfo.data.email;

        // Firestore Update Data Structure
        const updateData = {
            email: userEmail,
            status: 'Active',
            updatedAt: FieldValue.serverTimestamp()
        };

        // Only save refresh token if Google provides a new one
        if (tokens.refresh_token) {
            updateData.refreshToken = tokens.refresh_token;
        }

        // Save User Email & Tokens to Firestore
        await db.collection('clients').doc(userEmail).set(updateData, { merge: true });

        // Save current email in session
        req.session.userEmail = userEmail;

        res.send(`
            <div style="text-align:center; padding:50px; font-family:sans-serif; background:#0f172a; color:#fff; min-height:100vh;">
                <h2 style="color:#38bdf8;">Connection Successful!</h2>
                <p>Thank you, <b>${userEmail}</b>. DashPulse is now connected to your Google Workspace (Gmail, Photos, Drive, Docs, Calendar).</p>
                <p><a href="/api/gmail/messages?email=${userEmail}" style="color:#38bdf8;">Test Read Gmail Messages</a></p>
            </div>
        `);

    } catch (error) {
        console.error('Error during Auth Callback:', error);
        res.status(500).send('Authentication Failed. Please try again.');
    }
});

// TEST ROUTE: Fetch User Gmail Messages with Subject and Snippet details safely
app.get('/api/gmail/messages', async (req, res) => {
    const email = req.query.email || req.session.userEmail;

    if (!email) {
        return res.status(400).send('Email query parameter is required (e.g., /api/gmail/messages?email=user@gmail.com)');
    }

    try {
        // Fetch Refresh Token from Firestore
        const userDoc = await db.collection('clients').doc(email).get();

        if (!userDoc.exists || !userDoc.data().refreshToken) {
            return res.status(404).send('No Refresh Token found for this user. Please authenticate first.');
        }

        // Set Refresh Token to OAuth Client
        oauth2Client.setCredentials({
            refresh_token: userDoc.data().refreshToken
        });

        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        // Fetch latest 10 message list summaries
        const response = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 10
        });

        const messages = response.data.messages || [];
        const detailedMessages = [];

        // Loop through messages to fetch Subject, From and Snippet safely
        for (const msg of messages) {
            const msgDetail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'full'
            });

            const payload = msgDetail.data.payload || {};
            const headers = payload.headers || [];

            const subjectHeader = headers.find(h => h.name && h.name.toLowerCase() === 'subject');
            const fromHeader = headers.find(h => h.name && h.name.toLowerCase() === 'from');

            detailedMessages.push({
                id: msg.id,
                threadId: msg.threadId,
                subject: subjectHeader ? subjectHeader.value : 'No Subject',
                from: fromHeader ? fromHeader.value : 'Unknown Sender',
                snippet: msgDetail.data.snippet || ''
            });
        }

        res.json({
            message: 'Successfully fetched Gmail messages with details',
            email: email,
            messages: detailedMessages
        });

    } catch (error) {
        console.error('Error fetching Gmail messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ADMIN API ROUTE (Added for Admin Panel)
// ==========================================
app.get('/api/admin/clients', async (req, res) => {
    try {
        const snapshot = await db.collection('clients').get();
        const clients = [];
        snapshot.forEach(doc => {
            clients.push(doc.data());
        });
        res.json(clients);
    } catch (error) {
        console.error('Error fetching admin clients:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DashPulse Server running on port ${PORT}`));
