const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
// আপনার প্রজেক্ট অনুযায়ী ডেটাবেজ ও ক্লায়েন্ট কনফিগারেশন এখানে থাকবে
// const db = require('./db'); 
// const oauth2Client = require('./oauthClient');

const app = express();

// ১. স্ট্যাটিক ফাইল মিডলওয়্যার (এটি যোগ করার ফলে public ফোল্ডারের html পেজগুলো কাজ করবে)
app.use(express.static('public'));

// মিডলওয়্যার কনফিগারেশন
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'dashpulse_secret_key',
    resave: false,
    saveUninitialized: false
}));

// OAuth2 Client সেটআপ উদাহরণ (আপনার প্রজেক্টের সাথে মিলিয়ে নেবেন)
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// TEST ROUTE: Fetch User Gmail Messages with Official Label mapping and Full Body (Optimized)
app.get('/api/gmail/messages', async (req, res) => {
    const email = req.query.email || req.session.userEmail;

    if (!email) {
        return res.status(400).json({ error: 'Email query parameter is required' });
    }

    try {
        const userDoc = await db.collection('clients').doc(email).get();

        if (!userDoc.exists || !userDoc.data().refreshToken) {
            return res.status(404).json({ error: 'No Refresh Token found for this user.' });
        }

        oauth2Client.setCredentials({
            refresh_token: userDoc.data().refreshToken
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        // Fetch last 50 messages list
        const response = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 50
        });

        const messages = response.data.messages || [];

        // Promise.all ব্যবহার করে একসাথে সব মেসেজের বিস্তারিত ফেচ করা হলো (Super Fast)
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
                    return null; // যদি কোনো একটা মেসেজ ফেচ করতে সমস্যা হয়, যেন পুরো রিকোয়েস্ট ক্র্যাশ না করে
                }
            })
        );

        // নাল ভ্যালুগুলো ফিল্টার করে বাদ দেওয়া হলো
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
