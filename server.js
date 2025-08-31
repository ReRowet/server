import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import mime from 'mime-types';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ES modules fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE || 10 * 1024 * 1024; // 10MB default

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from storage
app.use('/storage', express.static(path.join(__dirname, 'storage')));

// Ensure storage directories exist
const storageDirs = [
  'storage/fonts',
  'storage/images',
  'storage/results',
  'storage/uploads',
  'storage/temp'
];

// Create storage directories if they don't exist
async function createStorageDirs() {
  for (const dir of storageDirs) {
    try {
      await fs.ensureDir(path.join(__dirname, dir));
      console.log(`✓ Directory ready: ${dir}`);
    } catch (error) {
      console.error(`✗ Failed to create directory ${dir}:`, error);
    }
  }
}

// Check if storage is writable
async function checkStoragePermissions() {
  try {
    const testFile = path.join(__dirname, 'storage', 'test-write.txt');
    await fs.writeFile(testFile, 'test-write-permission');
    await fs.remove(testFile);
    console.log('✓ Storage directory is writable');
    return true;
  } catch (error) {
    console.error('✗ Storage directory not writable:', error);
    return false;
  }
}

// Configure multer for file uploads with better error handling
const createMulterConfig = () => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      let uploadPath = '';
      
      if (file.fieldname === 'font') {
        uploadPath = 'storage/fonts/';
      } else if (file.fieldname === 'image') {
        uploadPath = 'storage/images/';
      } else if (file.fieldname === 'temp') {
        uploadPath = 'storage/temp/';
      } else {
        uploadPath = 'storage/uploads/';
      }
      
      cb(null, path.join(__dirname, uploadPath));
    },
    filename: (req, file, cb) => {
      const originalName = path.parse(file.originalname).name;
      const extension = path.extname(file.originalname);
      const uniqueName = `${originalName}-${uuidv4()}${extension}`;
      cb(null, uniqueName);
    }
  });

  const fileFilter = (req, file, cb) => {
    const allowedFontTypes = ['.ttf', '.otf', '.woff', '.woff2'];
    const allowedImageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const extension = path.extname(file.originalname).toLowerCase();

    console.log(`File upload attempt: ${file.fieldname}, ${file.originalname}, ${file.mimetype}`);

    if (file.fieldname === 'font') {
      if (allowedFontTypes.includes(extension)) {
        cb(null, true);
      } else {
        cb(new Error(`Jenis file font tidak didukung. Gunakan: ${allowedFontTypes.join(', ')}`), false);
      }
    } else if (file.fieldname === 'image') {
      if (allowedImageTypes.includes(extension)) {
        cb(null, true);
      } else {
        cb(new Error(`Jenis file gambar tidak didukung. Gunakan: ${allowedImageTypes.join(', ')}`), false);
      }
    } else {
      cb(null, true);
    }
  };

  return multer({
    storage: storage,
    limits: {
      fileSize: parseInt(MAX_FILE_SIZE),
      files: 5
    },
    fileFilter: fileFilter
  });
};

const upload = createMulterConfig();

// In-memory database (replace with real database in production)
let designs = [];
let nextId = 1;

// Helper functions
function getPublicUrl(filePath) {
  return `/storage/${path.relative(path.join(__dirname, 'storage'), filePath)}`;
}

async function saveBase64Image(base64Data, subfolder = 'results') {
  try {
    // Validate base64 data
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('Invalid base64 data');
    }

    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 image format');
    }

    const mimeType = matches[1];
    const data = matches[2];
    const extension = mime.extension(mimeType) || 'png';
    const buffer = Buffer.from(data, 'base64');

    const filename = `design-${uuidv4()}.${extension}`;
    const filePath = path.join(__dirname, 'storage', subfolder, filename);

    await fs.writeFile(filePath, buffer);
    
    return {
      filename,
      filePath,
      publicUrl: getPublicUrl(filePath),
      mimeType,
      size: buffer.length
    };
  } catch (error) {
    console.error('Error saving base64 image:', error);
    throw new Error(`Failed to save image: ${error.message}`);
  }
}

// Routes

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const storageWritable = await checkStoragePermissions();
    
    res.json({
      status: 'OK',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      storage: {
        writable: storageWritable,
        maxFileSize: MAX_FILE_SIZE
      },
      endpoints: [
        'POST /api/upload/font',
        'POST /api/upload/image',
        'POST /api/designs',
        'GET /api/designs',
        'GET /api/designs/:id',
        'DELETE /api/designs/:id'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload font file
app.post('/api/upload/font', upload.single('font'), async (req, res) => {
  try {
    console.log('Font upload request received');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Tidak ada file font yang diupload',
        details: 'Pastikan menggunakan form-data dengan field name "font"'
      });
    }

    const fontUrl = getPublicUrl(req.file.path);

    console.log('Font uploaded successfully:', {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      url: fontUrl
    });

    res.json({
      success: true,
      message: 'Font berhasil diupload',
      data: {
        fontUrl: fontUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('Font upload error:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File terlalu besar',
        details: `Maksimum ukuran file: ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }

    res.status(500).json({
      success: false,
      error: 'Gagal mengupload font',
      details: error.message
    });
  }
});

// Upload image file
app.post('/api/upload/image', upload.single('image'), async (req, res) => {
  try {
    console.log('Image upload request received');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Tidak ada file gambar yang diupload'
      });
    }

    const imageUrl = getPublicUrl(req.file.path);

    console.log('Image uploaded successfully:', {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      url: imageUrl
    });

    res.json({
      success: true,
      message: 'Gambar berhasil diupload',
      data: {
        imageUrl: imageUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        dimensions: req.file.size // You might want to add image dimensions detection
      }
    });

  } catch (error) {
    console.error('Image upload error:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File terlalu besar',
        details: `Maksimum ukuran file: ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }

    res.status(500).json({
      success: false,
      error: 'Gagal mengupload gambar',
      details: error.message
    });
  }
});

// Save final design
app.post('/api/designs', async (req, res) => {
  try {
    console.log('Save design request received');
    
    const {
      text,
      fontSize,
      fontColor,
      textPosition,
      fontUrl,
      canvasWidth,
      canvasHeight,
      finalImage
    } = req.body;

    // Validation
    if (!text || !finalImage) {
      return res.status(400).json({
        success: false,
        error: 'Data tidak lengkap',
        details: 'Text dan finalImage diperlukan'
      });
    }

    if (!finalImage.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Format gambar tidak valid',
        details: 'finalImage harus berupa data URL yang valid'
      });
    }

    // Save final image
    const imageInfo = await saveBase64Image(finalImage, 'results');

    // Create design object
    const design = {
      id: nextId++,
      text,
      fontSize: fontSize || 48,
      fontColor: fontColor || '#ffffff',
      textPosition: textPosition || { x: 50, y: 50 },
      fontUrl: fontUrl || null,
      canvasWidth: canvasWidth || 800,
      canvasHeight: canvasHeight || 400,
      imageUrl: imageInfo.publicUrl,
      imageInfo: {
        filename: imageInfo.filename,
        size: imageInfo.size,
        mimeType: imageInfo.mimeType
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    designs.push(design);

    console.log('Design saved successfully:', design.id);

    res.status(201).json({
      success: true,
      message: 'Design berhasil disimpan',
      data: {
        design: design,
        designId: design.id
      }
    });

  } catch (error) {
    console.error('Save design error:', error);
    
    if (error.message.includes('Invalid base64')) {
      return res.status(400).json({
        success: false,
        error: 'Format gambar tidak valid',
        details: 'Pastikan finalImage berupa base64 image yang valid'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Gagal menyimpan design',
      details: error.message
    });
  }
});

// Get all designs
app.get('/api/designs', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        count: designs.length,
        designs: designs
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Gagal mengambil data designs'
    });
  }
});

// Get single design
app.get('/api/designs/:id', (req, res) => {
  try {
    const design = designs.find(d => d.id === parseInt(req.params.id));
    
    if (!design) {
      return res.status(404).json({
        success: false,
        error: 'Design tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: {
        design: design
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Gagal mengambil data design'
    });
  }
});

// Delete design
app.delete('/api/designs/:id', async (req, res) => {
  try {
    const designIndex = designs.findIndex(d => d.id === parseInt(req.params.id));
    
    if (designIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Design tidak ditemukan'
      });
    }

    const design = designs[designIndex];
    
    // Delete image file from storage
    if (design.imageInfo && design.imageInfo.filename) {
      try {
        const imagePath = path.join(__dirname, 'storage', 'results', design.imageInfo.filename);
        await fs.remove(imagePath);
        console.log('Deleted image file:', design.imageInfo.filename);
      } catch (error) {
        console.warn('Could not delete image file:', error.message);
      }
    }

    designs.splice(designIndex, 1);

    res.json({
      success: true,
      message: 'Design berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete design error:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal menghapus design'
    });
  }
});

// Cleanup endpoint
app.delete('/api/cleanup', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const oldDesigns = designs.filter(d => new Date(d.createdAt) < cutoffDate);
    let deletedCount = 0;

    for (const design of oldDesigns) {
      if (design.imageInfo?.filename) {
        try {
          const imagePath = path.join(__dirname, 'storage', 'results', design.imageInfo.filename);
          await fs.remove(imagePath);
          deletedCount++;
        } catch (error) {
          console.warn('Could not delete file:', error.message);
        }
      }
    }

    designs = designs.filter(d => new Date(d.createdAt) >= cutoffDate);

    res.json({
      success: true,
      message: `Cleanup completed`,
      data: {
        deletedFiles: deletedCount,
        remainingDesigns: designs.length
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Gagal melakukan cleanup'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File terlalu besar',
        details: `Maksimum ukuran file: ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Terlalu banyak file'
      });
    }
  }

  res.status(500).json({
    success: false,
    error: 'Terjadi kesalahan internal server',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint tidak ditemukan',
    details: `Method: ${req.method}, Path: ${req.originalUrl}`
  });
});

// Initialize server
async function startServer() {
  try {
    console.log('🚀 Starting Text Editor API Server...');
    console.log('📁 Creating storage directories...');
    
    await createStorageDirs();
    await checkStoragePermissions();

    app.listen(PORT, () => {
      console.log('\n✅ Server started successfully!');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`💾 Storage: ${path.join(__dirname, 'storage')}`);
      console.log(`📏 Max file size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      console.log('\n🛣️  Available endpoints:');
      console.log('   POST   /api/upload/font');
      console.log('   POST   /api/upload/image');
      console.log('   POST   /api/designs');
      console.log('   GET    /api/designs');
      console.log('   GET    /api/designs/:id');
      console.log('   DELETE /api/designs/:id');
      console.log('   DELETE /api/cleanup?days=7');
      console.log('\n⚡ Server is ready to accept requests!');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Start the server
startServer();