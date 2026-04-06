const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });


const app = express()
const port = process.env.PORT || 5000

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import Routes
const authRoutes = require('./routes/auth');
const dataManagerRoutes = require('./routes/dataManager');
const dashboardRoutes = require('./routes/dashboard');

// Register Routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataManagerRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Basic Routes
app.get('/', (req, res) => {
    res.json({ message: 'District Intelligence API v1' });
});

app.use('/api/v1/auth', authRoutes);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
