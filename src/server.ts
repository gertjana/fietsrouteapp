import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as path from 'path';
import apiRoutes from './routes/api';

const app: Express = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Routes
app.use('/api', apiRoutes);

// Serve main page
app.get('/', (req: Request, res: Response): void => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: err.message 
    });
});

// 404 handler
app.use((req: Request, res: Response): void => {
    res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, (): void => {
    console.log(`🚴‍♀️ Nederlandse Fietsknooppunten Tracker`);
    console.log(`🌐 Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${path.join(process.cwd(), 'public')}`);
    console.log(`🔄 Use 'npm run dev' for auto-reload development`);
});
