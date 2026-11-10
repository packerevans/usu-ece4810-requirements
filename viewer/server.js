const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 3007;

const LATEX_DIR = path.join(__dirname, '..');
const TEX_FILES = [
  'SpecTemplate.tex',
  'Formatting.tex',
  'FrontMatter.tex',
  'Scope.tex',
  'ApplicableDocuments.tex',
  'StakeholderRequirements.tex',
  'EngineeringRequirements.tex',
  'VerificationOfRequirements.tex'
];

app.use(express.json());
app.use(express.static('public'));

const server = app.listen(PORT, () => {
  console.log(`LaTeX viewer running on http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

TEX_FILES.forEach(filename => {
  const filePath = path.join(LATEX_DIR, filename);
  fs.watch(filePath, (eventType) => {
    if (eventType === 'change') {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        broadcast({
          type: 'file-changed',
          filename,
          content
        });
        console.log(`File changed: ${filename}`);

        setTimeout(() => {
          compile();
        }, 100);
      } catch (err) {
        console.error(`Error reading ${filename}:`, err);
      }
    }
  });
});

app.get('/api/files', (req, res) => {
  try {
    const files = TEX_FILES.map(filename => {
      const content = fs.readFileSync(path.join(LATEX_DIR, filename), 'utf8');
      return { filename, content };
    });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save/:filename', (req, res) => {
  const { filename } = req.params;
  const { content } = req.body;

  if (!TEX_FILES.includes(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  try {
    fs.writeFileSync(path.join(LATEX_DIR, filename), content, 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compile', (req, res) => {
  compile()
    .then(result => res.json(result))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/pdf', (req, res) => {
  res.sendFile(path.join(LATEX_DIR, 'SpecTemplate.pdf'));
});

function compile() {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const proc = spawn('pdflatex', [
      '-interaction=nonstopmode',
      'SpecTemplate.tex'
    ], {
      cwd: LATEX_DIR,
      shell: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;

      const result = {
        success: code === 0,
        duration,
        timestamp: new Date().toISOString()
      };

      if (code !== 0) {
        const errorMatch = stdout.match(/^!.*$/m);
        result.error = errorMatch ? errorMatch[0] : 'Compilation failed';
        result.output = stdout.slice(-500);
      } else {
        result.message = 'Compilation successful';
      }

      broadcast({
        type: 'compile-complete',
        result
      });

      resolve(result);
    });
  });
}
