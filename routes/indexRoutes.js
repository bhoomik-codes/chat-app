const express = require('express');
const path = require('path');
const router = express.Router();

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/home.html'));
})

router.post('/home', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/index.html'));
})

router.post('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/register.html'));
})

module.exports = router;

