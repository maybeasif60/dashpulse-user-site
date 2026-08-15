// TEST ROUTE: Fetch User Gmail Messages with Official Label mapping
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
        
        // Fetch last 50 messages
        const response = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 50
        });

        const messages = response.data.messages || [];
        const detailedMessages = [];

        for (const msg of messages) {
            // Fetch full message to get labels and headers
            const msgDetail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'full'
            });

            const payload = msgDetail.data.payload || {};
            const headers = payload.headers || [];

            const subjectHeader = headers.find(h => h.name && h.name.toLowerCase() === 'subject');
            const fromHeader = headers.find(h => h.name && h.name.toLowerCase() === 'from');

            // labelIds সরাসরি জিমেইল থেকে আসছে (যেমন: ["INBOX", "STARRED", "CATEGORY_PROMOTIONS"])
            const labels = msgDetail.data.labelIds || [];

            detailedMessages.push({
                id: msg.id,
                threadId: msg.threadId,
                subject: subjectHeader ? subjectHeader.value : '(No Subject)',
                from: fromHeader ? fromHeader.value : 'Unknown Sender',
                snippet: msgDetail.data.snippet || '',
                labelIds: labels // এই ল্যাবেলগুলোই এখন ফ্রন্টএন্ডে ফিল্টারিং এর কাজে লাগবে
            });
        }

        res.json({
            email: email,
            messages: detailedMessages
        });

    } catch (error) {
        console.error('Error fetching Gmail messages:', error);
        res.status(500).json({ error: error.message });
    }
});
