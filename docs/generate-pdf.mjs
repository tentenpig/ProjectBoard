import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'TECHNICAL.html');
const pdfPath = path.join(__dirname, 'TECHNICAL.pdf');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });

// Wait for Mermaid to render
await page.waitForFunction(() => !document.querySelector('.mermaid[data-processed="false"]'), { timeout: 10000 }).catch(() => {});
await new Promise(r => setTimeout(r, 2000));

await page.pdf({
  path: pdfPath,
  format: 'A4',
  margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
  printBackground: true,
});

await browser.close();
console.log('PDF generated:', pdfPath);
