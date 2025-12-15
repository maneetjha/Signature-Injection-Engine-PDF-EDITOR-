const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const mongoose = require('mongoose');

// --- MongoDB Configuration ---
const MONGO_URL = process.env.MONGO_URL;

const AuditSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    pdfName: { type: String, required: true },
    originalHash: { type: String, required: true },
    signedHash: { type: String, required: true },
    fields: { type: Array, required: true },
});
const AuditEntry = mongoose.model('AuditEntry', AuditSchema);

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✓ MongoDB connection established successfully.');
    } catch (err) {
        console.error('✗ MongoDB connection error:', err.message);
    }
}

// --- Multer Configuration ---
const upload = multer({ 
  dest: 'uploads/',
  limits: { 
    fileSize: 50 * 1024 * 1024, 
    fieldSize: 10 * 1024 * 1024 
  }
});

// --- Core PDF Injection Logic ---
class SignatureInjectionEngine {
    constructor() {
        this.A4_WIDTH = 595;
        this.A4_HEIGHT = 842;
    }

    parseBase64Image(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return null;
        const parts = dataUrl.split(';base64,');
        if (parts.length !== 2) return null;
        const mime = parts[0].split(':')[1];
        const buffer = Buffer.from(parts[1], 'base64');
        return { buffer, mime };
    }

    /**
     * Converts normalized (percentage) coordinates into absolute PDF points.
     * Crucially handles PDF-lib's bottom-left origin for the Y-axis.
     */
    normalizeCoordinates(field, pdfWidth, pdfHeight) {
        return {
            x: field.xPct * pdfWidth,
            // Invert Y-coordinate calculation for bottom-left origin
            y: (1 - field.yPct - field.hPct) * pdfHeight, 
            width: field.wPct * pdfWidth,
            height: field.hPct * pdfHeight,
        };
    }

    /**
     * Draws a single field onto the PDF page using PDF-lib.
     */
    async injectField(pdfDoc, page, field, font) {
        const { width: pdfWidth, height: pdfHeight } = page.getSize();
        const pdfCoords = this.normalizeCoordinates(field, pdfWidth, pdfHeight);

        // --- Draw Bounding Box (Conditional) ---
        // Only draw the bounding box for radio fields (for visibility).
        if (field.type === 'radio') { 
            page.drawRectangle({
                x: pdfCoords.x,
                y: pdfCoords.y,
                width: pdfCoords.width,
                height: pdfCoords.height,
                borderColor: rgb(0.1, 0.4, 0.8), 
                borderWidth: 1,
                opacity: 0.1,
            });
        }
        // ----------------------------------------

        switch (field.type) {
            case 'signature':
            case 'image': {
                const imageData = this.parseBase64Image(field.value);
                if (!imageData) return;

                let pdfImage;
                if (imageData.mime === 'image/png') {
                    pdfImage = await pdfDoc.embedPng(imageData.buffer);
                } else if (imageData.mime === 'image/jpeg' || imageData.mime === 'image/jpg') {
                    pdfImage = await pdfDoc.embedJpg(imageData.buffer);
                } else {
                    return;
                }
                
                page.drawImage(pdfImage, {
                    x: pdfCoords.x,
                    y: pdfCoords.y,
                    width: pdfCoords.width,
                    height: pdfCoords.height,
                });
                break;
            }

            case 'text':
            case 'date': {
                if (!field.value) return;
                
                const fontSize = 10;
                
                page.drawText(field.value, {
                    x: pdfCoords.x + 2, 
                    // Calculate Y position relative to the field's top edge
                    y: pdfCoords.y + pdfCoords.height - fontSize - 2, 
                    size: fontSize,
                    font: font, 
                    color: rgb(0, 0, 0),
                });
                break;
            }

            case 'radio': {
                if (!field.value) return; 

                page.drawCircle({
                    x: pdfCoords.x + pdfCoords.width / 2,
                    y: pdfCoords.y + pdfCoords.height / 2,
                    size: pdfCoords.width / 4,
                    color: rgb(0, 0, 1), 
                    borderWidth: 1,
                    borderColor: rgb(0, 0, 0.8),
                    backgroundColor: rgb(0, 0, 1),
                });
                break;
            }
        }
    }
    
    /**
     * Logs the transaction details and file hashes to the MongoDB audit collection.
     */
    async logAuditEntry(pdfName, originalHash, signedHash, fieldsPayload) {
        try {
            const audit = new AuditEntry({
                pdfName: pdfName,
                originalHash: originalHash,
                signedHash: signedHash,
                fields: fieldsPayload,
            });
            await audit.save();
            console.log(`[DB] Audit log saved for ${pdfName}`);
        } catch (error) {
            console.error('[DB] Failed to save audit log:', error.message);
        }
    }

    /**
     * Main function to load PDF, inject all fields, and save the result.
     */
    async injectFields(pdfPath, pdfName, fieldsPayload, outputPath) {
        try {
            const existingPdfBytes = await fs.readFile(pdfPath);
            // Calculate hash of the original document for integrity audit
            const originalHash = crypto.createHash('sha256').update(existingPdfBytes).digest('hex');

            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            const standardFont = await pdfDoc.embedFont(StandardFonts.Helvetica); 
            
            const pages = pdfDoc.getPages();
            
            for (const field of fieldsPayload) {
                const pageNumber = field.pageNumber || 0;
                if (pageNumber >= pages.length) continue;
                
                const page = pages[pageNumber];
                await this.injectField(pdfDoc, page, field, standardFont);
            }

            const pdfBytes = await pdfDoc.save();
            await fs.writeFile(outputPath, pdfBytes);

            // Calculate hash of the signed document
            const finalHash = crypto.createHash('sha256').update(pdfBytes).digest('hex');

            console.log('\n--- AUDIT TRAIL ---');
            console.log(`Original PDF Hash: ${originalHash}`);
            console.log(`Signed PDF Hash: ${finalHash}`);
            console.log('-------------------\n');
            
            this.logAuditEntry(pdfName, originalHash, finalHash, fieldsPayload);

            return outputPath;
        } catch (error) {
            console.error("Error during PDF injection:", error);
            throw new Error(`PDF injection failed: ${error.message}`);
        }
    }
}

// --- Express App Setup ---
const app = express();
const port = 3000;
const engine = new SignatureInjectionEngine();

// Serve the React frontend build
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Initialize directories and database connection
(async () => {
    await fs.mkdir('uploads', { recursive: true });
    await fs.mkdir('output', { recursive: true });
    await connectDB();
})();


// Main API Endpoint for Field Burning
app.post('/api/burn-fields', upload.single('pdf'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No PDF file uploaded.' });
    }

    try {
        const pdfPath = req.file.path;
        const pdfName = req.file.originalname; 
        const fieldsJson = req.body.fields; 

        if (!fieldsJson) {
            await fs.unlink(pdfPath);
            return res.status(400).json({ message: 'Missing fields payload.' });
        }

        const fieldsPayload = JSON.parse(fieldsJson);
        const outputFilename = `signed-${req.file.filename}.pdf`;
        const outputPath = path.join('output', outputFilename);

        await engine.injectFields(pdfPath, pdfName, fieldsPayload, outputPath);

        // Send the generated PDF back to the client
        res.download(outputPath, outputFilename, async (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            // Cleanup temporary files after sending
            await fs.unlink(pdfPath).catch(e => console.error("Cleanup error (uploads):", e));
            await fs.unlink(outputPath).catch(e => console.error("Cleanup error (output):", e));
        });

    } catch (error) {
        console.error("API Error:", error);
        // Ensure the uploaded file is removed even on failure
        if (req.file && req.file.path) {
             await fs.unlink(req.file.path).catch(e => console.error("Cleanup error (failure):", e));
        }
        res.status(500).json({ message: error.message || 'Internal Server Error during PDF processing.' });
    }
});


app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});


app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});