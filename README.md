# 📄 Signature Injection Engine

The Signature Injection Engine is a full-stack application designed to securely upload PDF documents, allow users to digitally place various fields (signatures, text, dates, images, and radio buttons) on them using a normalized coordinate system, and generate a final, signed PDF with immutable audit logs stored in MongoDB.

This system ensures high integrity by calculating and storing SHA-256 hashes of the original and signed documents, providing a complete audit trail for all transactions.

## ✨ Features

  * **Drag & Drop PDF Viewer:** Interactive frontend built with React and Tailwind CSS.
  * **Normalized Placement:** Fields are placed using percentage-based coordinates (`xPct`, `yPct`) on the frontend, ensuring fields are placed correctly regardless of the PDF's actual resolution on the backend.
  * **Multiple Field Types:** Supports drawing and burning of:
      * Signature (Drawn using a Canvas/DataURL)
      * Text Input
      * Date Selection (Formatted as `DD/MM/YYYY` in the output)
      * Image/Stamp Upload
      * Radio Buttons
  * **Audit Trail:** Server-side logic calculates SHA-256 hashes of the original and final PDF documents.
  * **MongoDB Logging:** All transaction data, including field placement coordinates and document hashes, is logged to MongoDB for integrity verification.
  * **Temporary File Handling:** Robust cleanup logic ensures uploaded and output files are deleted immediately after the client receives the signed document.

## 🛠️ Tech Stack

  * **Frontend:** React, Vite, Tailwind CSS
  * **Backend:** Node.js, Express.js
  * **PDF Processing:** `pdf-lib` (Node.js)
  * **Database:** MongoDB (`mongoose`)
  * **Utilities:** `multer` (File Uploads), `crypto` (Hashing)

## 🚀 Getting Started

### Prerequisites

You need the following installed on your machine:

  * Node.js (v18+)
  * npm or yarn
  * A running MongoDB instance (local or Atlas cluster)

### 1\. Project Setup

Clone the repository and install dependencies in both the root and frontend directories:

```bash
# Assuming the root directory contains the server.js and package.json
npm install

# Navigate to the frontend directory if needed (depending on your setup)
cd frontend/
npm install
cd ..
```

### 2\. Configuration (`.env` file)

Create a file named `.env` in the root directory and add your MongoDB connection string:

```
# .env file
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.pifo4om.mongodb.net/
```

### 3\. Build the Frontend

Before running the server, build the React frontend:

```bash
cd frontend
npm run build
cd ..
```

The server is configured to serve static files from `frontend/dist`.

### 4\. Run the Server

Start the Node.js server from the root directory:

```bash
npm start
# Server listening at http://localhost:3000
```

## 💻 Usage

1.  Open your browser to **`http://localhost:3000`**.
2.  **Upload** a PDF document.
3.  Select a **Tool** (e.g., Signature, Text Box) from the palette.
4.  **Click** on the PDF to place the field.
5.  **Drag, resize, or enter content** into the field.
6.  Click **Generate Signed PDF**.
7.  The final PDF will download, and the transaction details (including the immutable hashes) will be logged to your Node.js console and MongoDB.

## 🏗️ Architecture Overview

The system follows a typical client-server interaction pattern for PDF processing.

1.  **Client (`App.jsx`):**

      * Collects field definitions (position, type, value).
      * Converts PDF point coordinates (x, y, w, h) into percentages (`xPct`, `yPct`) relative to the A4 standard dimensions (`595x842`).
      * Submits the original PDF file and a JSON payload of normalized fields to the API.

2.  **Server (`server.js`):**

      * Receives PDF and JSON payload via `multer`.
      * **Audit Trail:** Reads the original PDF bytes and calculates the `originalHash`.
      * **Normalization:** Uses the percentage values (`xPct`, etc.) and the **actual** dimensions of the uploaded PDF page to calculate the final pixel-perfect position using the `normalizeCoordinates` function.
      * **Injection:** Uses `pdf-lib` to draw fields onto the PDF.
      * **Final Audit:** Calculates the `signedHash` of the output PDF.
      * **Logging:** Saves both hashes and the field payload to the MongoDB `AuditEntry` collection.
      * **Cleanup:** Sends the signed PDF to the client and deletes the temporary files.

### Core Coordinate Transformation

The key to reliable placement is the **Normalized Coordinate System** implemented in the `SignatureInjectionEngine` class, which correctly handles the conversion from the frontend's top-left origin to the PDF standard's bottom-left origin:

```javascript
// Client-Side (App.jsx) sends:
// xPct: field.x / 595, yPct: field.y / 842 

// Server-Side (server.js) uses actual PDF page dimensions:
normalizeCoordinates(field, pdfWidth, pdfHeight) {
    return {
        x: field.xPct * pdfWidth,
        // Y-axis inverted for PDF-lib's bottom-left origin
        y: (1 - field.yPct - field.hPct) * pdfHeight, 
        width: field.wPct * pdfWidth,
        height: field.hPct * pdfHeight,
    };
}
```