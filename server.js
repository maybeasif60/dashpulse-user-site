const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');

// আপনার প্রজেক্ট অনুযায়ী ডেটাবেজ কনফিগারেশন (যেমন Firestore বা অন্য কিছু)
// উদাহরণস্বরূপ: const db = require('./db'); 

const app = express();

// ১. স্ট্যাটিক ফাইল মিডলওয়্যার
app.use(express.static('public'));

// মিডলওয়্যার কনফিগারেশন
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'dashpulse_secret_key',
    resave: false,
    saveUninitialized: false
}));

// OAuth2 Client সেটআপ
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// ২. গুগল লগইন শুরু করার রাউট (পাসপোর্ট ছাড়া সরাসরি রিডাইরেক্ট)
app.get('/auth/google', (req, res) => {
    const scopes = [
        'profile',
        'email',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/photoslibrary.readonly'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });

    res.redirect(authUrl);
});

// ৩. গুগল থেকে ঘুরে আসার পর কলব্যাক রাউট
app.get('/auth/google/callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send('Authorization code not found from Google.');
    }

    try {
        // কোড দিয়ে টোকেন এক্সচেঞ্জ করা
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // ইউজারের প্রফাইল ইনফো ফেচ করা
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        // যদি ডাটাবেজ (db) কানেক্ট করা থাকে, তবে রিফ্রেশ টোকেন সেভ হবে
        if (tokens.refresh_token && typeof db !== 'undefined') {
            await db.collection('clients').doc(email).set({
                email: email,
                refreshToken: tokens.refresh_token,
                updatedAt: new Date()
            }, { merge: true });
        }

        // সফলভাবে লগইন হলে সেশনে ইমেইল সেভ করে ড্যাশবোর্ডে রিডাইরেক্ট হবে
        req.session.userEmail = email;
        res.redirect('/dashboard.html');

    } catch (error) {
        console.error('Error during Google callback token exchange:', error);
        res.status(500).send('Authentication failed: ' + error.message);
    }
});

// ৪. Gmail Messages ফেচ করার রাউট
app.get('/api/gmail/messages', async (req, res) => {
    const email = req.query.email || req.session.userEmail;

    if (!email) {
        return res.status(400).json({ error: 'Email query parameter is required' });
    }

    try {
        if (typeof db === 'undefined') {
            return res.status(500).json({ error: 'Database instance is not defined in backend.' });
        }

        const userDoc = await db.collection('clients').doc(email).get();

        if (!userDoc.exists || !userDoc.data().refreshToken) {
            return res.status(404).json({ error: 'No Refresh Token found for this user.' });
        }

        oauth2Client.setCredentials({
            refresh_token: userDoc.data().refreshToken
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        const response = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 50
        });

        const messages = response.data.messages || [];

        const detailedMessages = await Promise.all(
            messages.map(async (msg) => {
                try {
                    const msgDetail = await gmail.users.messages.get({
                        userId: 'me',
                        id: msg.id,
                        format: 'full'
                    });

                    const payload = msgDetail.data.payload || {};
                    const headers = payload.headers || [];

                    const subjectHeader = headers.find(h => h.name && h.name.toLowerCase() === 'subject');
                    const fromHeader = headers.find(h => h.name && h.name.toLowerCase() === 'from');
                    const labels = msgDetail.data.labelIds || [];

                    let bodyContent = '';
                    
                    function getEmailBody(part) {
                        if (part.body && part.body.data) {
                            let buff = Buffer.from(part.body.data, 'base64');
                            bodyContent += buff.toString('utf-8');
                        }
                        if (part.parts) {
                            part.parts.forEach(p => getEmailBody(p));
                        }
                    }

                    if (payload.parts) {
                        payload.parts.forEach(part => getEmailBody(part));
                    } else if (payload.body && payload.body.data) {
                        let buff = Buffer.from(payload.body.data, 'base64');
                        bodyContent = buff.toString('utf-8');
                    }

                    return {
                        id: msg.id,
                        threadId: msg.threadId,
                        subject: subjectHeader ? subjectHeader.value : '(No Subject)',
                        from: fromHeader ? fromHeader.value : 'Unknown Sender',
                        snippet: msgDetail.data.snippet || '',
                        body: bodyContent || msgDetail.data.snippet,
                        labelIds: labels
                    };
                } catch (err) {
                    console.error(`Error fetching message ID ${msg.id}:`, err.message);
                    return null;
                }
            })
        );

        const validMessages = detailedMessages.filter(m => m !== null);

        res.json({
            email: email,
            messages: validMessages
        });

    } catch (error) {
        console.error('Error fetching Gmail messages:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
