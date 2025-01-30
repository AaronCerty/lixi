const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const port = 3000;

// Trust proxy (needed for rate limiting behind reverse proxies)
app.set('trust proxy', 1);

// Rate limiter for DDOS protection
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Quá nhiều yêu cầu từ IP của bạn, vui lòng thử lại sau 15 phút!'
});

// Apply rate limiter to all routes
app.use(limiter);

// Special limiter for lucky money endpoint
const luckyMoneyLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // Limit each IP to 5 requests per minute
    message: 'Vui lòng đợi 1 phút trước khi thử lại!'
});

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Store lucky money recipients and used IPs
let recipients = new Set();
let usedIPs = new Set();
const logFile = path.join(__dirname, 'lixi.log');
const quantityLogFile = path.join(__dirname, 'quantity.log');

// Initial quantities configuration
const initialQuantities = [
    { amount: 500000, quantity: 1 },
    { amount: 100000, quantity: 1 },
    { amount: 50000, quantity: 1 },
    { amount: 20000, quantity: 10 },
    { amount: 10000, quantity: 15 }
];

// Function to recalculate quantities based on lixi.log
const recalculateQuantities = () => {
    // Start with initial quantities
    const quantities = initialQuantities.map(q => ({ ...q }));
    
    if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach(line => {
            if (line.includes('Tên:')) {
                const match = line.match(/Số tiền: (.*?) VNĐ/);
                if (match) {
                    const amountStr = match[1];
                    const amount = parseInt(amountStr.replace(/\./g, ''));
                    const quantityIndex = quantities.findIndex(q => q.amount === amount);
                    if (quantityIndex !== -1) {
                        quantities[quantityIndex].quantity--;
                    }
                }
            }
        });
    }
    
    return quantities;
};

// Function to save quantities to log
const saveQuantities = (quantities) => {
    const content = `=== Số lượng lì xì còn lại Tết 2025 ===\n\n${
        quantities.map(q => `${q.amount}|${q.quantity}`).join('\n')
    }`;
    fs.writeFileSync(quantityLogFile, content);
};

// Function to load quantities
const loadQuantities = () => {
    // Always recalculate based on lixi.log
    const quantities = recalculateQuantities();
    saveQuantities(quantities);
    return quantities;
};

// Function to get random amount from remaining pool
const getRandomAmount = () => {
    const quantities = loadQuantities();
    
    // Filter out amounts with zero quantity
    const availableAmounts = quantities.filter(q => q.quantity > 0);
    
    if (availableAmounts.length === 0) {
        return null;
    }
    
    // Get random amount from available amounts
    const randomIndex = Math.floor(Math.random() * availableAmounts.length);
    return availableAmounts[randomIndex].amount;
};

// Function to log recipient information
const logRecipient = (name, accountNumber, bank, amount, ip) => {
    const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const logEntry = `[${timestamp}] Tên: ${name}, STK: ${accountNumber}, Ngân hàng: ${bank}, Số tiền: ${amount.toLocaleString('vi-VN')} VNĐ, IP: ${ip}\n`;
    fs.appendFileSync(logFile, logEntry);
};

// Function to get recipients list from log
const getRecipientsFromLog = () => {
    if (!fs.existsSync(logFile)) return [];
    
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    const recipientsList = [];
    
    lines.forEach(line => {
        if (line.includes('Tên:')) {
            const match = line.match(/\[(.*?)\] Tên: (.*?), STK: (.*?), Ngân hàng: (.*?), Số tiền: (.*?) VNĐ, IP: (.*?)$/);
            if (match) {
                const [_, timestamp, name, accountNumber, bank, amount, ip] = match;
                recipientsList.push({
                    timestamp,
                    name,
                    accountNumber,
                    bank,
                    amount,
                    ip
                });
                // Add IP to used IPs set
                usedIPs.add(ip);
            }
        }
    });
    
    return recipientsList;
};

// Function to parse log file and load recipients
const loadRecipientsFromLog = () => {
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, `=== Danh sách người nhận lì xì Tết 2025 ===\n\n`);
        return new Set();
    }

    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    const loadedRecipients = new Set();
    usedIPs.clear(); // Reset used IPs
    
    lines.forEach(line => {
        if (line.includes('Tên:')) {
            const match = line.match(/Tên: (.*?), STK: (.*?), Ngân hàng: (.*?),.*?IP: (.*?)$/);
            if (match) {
                const [_, name, accountNumber, bank, ip] = match;
                loadedRecipients.add(`${name}-${accountNumber}-${bank}`);
                usedIPs.add(ip);
            }
        }
    });

    // Recalculate quantities whenever recipients are loaded
    loadQuantities();

    return loadedRecipients;
};

// Function to get remaining quantities
const getRemainingQuantities = () => {
    const quantities = loadQuantities();
    return {
        denominations: quantities,
        totalRemaining: quantities.reduce((sum, item) => sum + item.quantity, 0)
    };
};

// Watch for changes in lixi.log
fs.watchFile(logFile, (curr, prev) => {
    console.log('Phát hiện thay đổi trong file lixi.log, đang cập nhật lại...');
    
    // Reload recipients from log
    recipients = loadRecipientsFromLog();
    console.log(`Đã cập nhật lại danh sách người nhận: ${recipients.size} người`);
    
    // Recalculate quantities
    const quantities = recalculateQuantities();
    saveQuantities(quantities);
    console.log('Đã cập nhật lại số lượng lì xì.');
    
    // Log current quantities
    console.log('Số lượng hiện tại:');
    quantities.forEach(item => {
        console.log(`${item.amount.toLocaleString('vi-VN')}đ: ${item.quantity} tờ`);
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/recipients', (req, res) => {
    const recipientsList = getRecipientsFromLog();
    const remaining = getRemainingQuantities();
    res.json({
        recipients: recipientsList,
        remainingCount: remaining.totalRemaining,
        totalRecipients: recipientsList.length,
        remainingDenominations: remaining.denominations
    });
});

app.post('/lucky-money', luckyMoneyLimiter, (req, res) => {
    const { name, accountNumber, bank } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Check if IP has already received lucky money
    if (usedIPs.has(clientIP)) {
        return res.status(400).json({ 
            message: 'Mỗi IP chỉ được nhận lì xì một lần!' 
        });
    }

    // Check if we've reached the maximum number of recipients
    const remaining = getRemainingQuantities();
    if (remaining.totalRemaining === 0) {
        return res.status(400).json({ 
            message: 'Đã hết lì xì! Chúc bạn may mắn lần sau!' 
        });
    }

    // Check if this account has already received lucky money
    const recipientKey = `${name}-${accountNumber}-${bank}`;
    if (recipients.has(recipientKey)) {
        return res.status(400).json({ 
            message: 'Bạn đã nhận lì xì rồi!' 
        });
    }

    // Generate random amount from pool
    const amount = getRandomAmount();
    if (amount === null) {
        return res.status(400).json({ 
            message: 'Đã hết lì xì! Chúc bạn may mắn lần sau!' 
        });
    }

    // Add recipient to the set and log
    recipients.add(recipientKey);
    usedIPs.add(clientIP);
    logRecipient(name, accountNumber, bank, amount, clientIP);

    // Get updated remaining quantities
    const updatedRemaining = getRemainingQuantities();

    // Return success response
    res.json({
        amount,
        remainingCount: updatedRemaining.totalRemaining,
        remainingDenominations: updatedRemaining.denominations,
        message: 'Chúc mừng năm mới!'
    });
});

// Load recipients when starting server
app.listen(port, () => {
    recipients = loadRecipientsFromLog();
    const remaining = getRemainingQuantities();
    console.log(`Server đang chạy tại http://localhost:${port}`);
    console.log(`Đã có ${recipients.size} người nhận lì xì. Còn lại ${remaining.totalRemaining} lượt.`);
    console.log('Số lượng còn lại theo mệnh giá:');
    remaining.denominations.forEach(item => {
        console.log(`${item.amount.toLocaleString('vi-VN')}đ: ${item.quantity} tờ`);
    });
});