const express = require('express');
const app = express();
app.use(express.json());

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' from ' + url);
      return resp;
    } catch (err) {
      console.warn('Attempt ' + attempt + '/' + retries + ' failed: ' + err.message);
      if (attempt < retries) await sleep(delayMs * attempt);
      else throw err;
    }
  }
}

app.post('/download', async (req, res) => {
  const { url, filename } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const pageResp = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    }, 3, 3000);
    const html = await pageResp.text();
    const finalUrl = pageResp.url;

    const reqidMatch = html.match(/document\.reqid\s*=\s*['"]([^'"]+)['"]/);
    if (!reqidMatch) return res.status(500).json({ error: 'Could not find reqid', snippet: html.substring(0, 300) });
    const reqid = reqidMatch[1];
    console.log('reqid:', reqid);

    const apiUrl = 'https://bejbej.ca/vrp/index.php?d=' + Math.random() + '/';
    const apiResp = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': finalUrl,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      },
      body: new URLSearchParams({ reqid, act: 'start' })
    }, 3, 4000);
    const data = await apiResp.json();
    let codeLink = data.code_link;
    if (!codeLink) return res.status(500).json({ error: 'No code_link', data });
    if (codeLink.startsWith('/')) codeLink = 'https://bejbej.ca' + codeLink;
    console.log('Downloading from:', codeLink);

    const fileResp = await fetchWithRetry(codeLink, {
      headers: {
        'Referer': finalUrl,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      }
    }, 3, 5000);
    const buffer = Buffer.from(await fileResp.arrayBuffer());
    const contentType = fileResp.headers.get('content-type') || 'audio/mp4';
    console.log('Downloaded', buffer.length, 'bytes');

    res.set('Content-Type', contentType);
    res.set('Content-Disposition', 'attachment; filename="' + (filename || 'audio.m4a') + '"');
    return res.send(buffer);
  } catch (err) {
    console.error('Download failed after all retries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(3333, () => console.log('VRP downloader listening on port 3333 (with retries)'));
