require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const session = require('express-session');
const path = require('path');

// Firebase Admin Modular Import
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();

// Initialize Firebase Admin safely
if (getApps().length === 0) {
    initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID
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

// Auth Route
app.get('/auth/google', (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email'
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

        // Save User Email & Refresh Token to Firestore
        await db.collection('clients').doc(userEmail).set({
            email: userEmail,
            refreshToken: tokens.refresh_token,
            status: 'Active',
            createdAt: FieldValue.serverTimestamp()
        }, { merge: true });

        res.send(`
            <div style="text-align:center; padding:50px; font-family:sans-serif; background:#0f172a; color:#fff; min-height:100vh;">
                <h2 style="color:#38bdf8;">Connection Successful!</h2>
                <p>Thank you, <b>${userEmail}</b>. DashPulse is now connected to your inbox.</p>
            </div>
        `);

    } catch (error) {
        console.error('Error during Auth Callback:', error);
        res.status(500).send('Authentication Failed. Please try again.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DashPulse Server running on port ${PORT}`));
