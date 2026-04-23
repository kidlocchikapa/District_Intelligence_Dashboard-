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
const educationRoutes = require('./routes/education');
const healthRoutes = require('./routes/health');
const disasterRoutes = require('./routes/disaster');
const adminRoutes = require('./routes/admin');
const adminDataRoutes = require('./routes/adminData');
const welfareRoutes = require('./routes/welfare');

// Register Routes
app.use("/api/v1/auth", authRoutes);
app.use('/api/v1/data', dataManagerRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/dashboard/education', educationRoutes);
app.use('/api/v1/dashboard/health', healthRoutes);
app.use('/api/v1/dashboard/disaster', disasterRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/admin-data', adminDataRoutes);
app.use('/api/v1/dashboard/welfare', welfareRoutes);

// Basic Routes
app.get(['/', '/api/v1', '/api/v1/'], (req, res) => {
    res.json({ message: 'District Intelligence API v1' });
});



app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
