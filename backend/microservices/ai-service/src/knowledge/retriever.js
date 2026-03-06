const path = require('path');
const fs = require('fs');

const DOCS_DIR = path.join(__dirname, '../../../../docs');

const CANDIDATE_FILES = [
  'APPLICATION-KNOWLEDGE-FOR-AI.md',
  'ai-assistant-requirements.md',
  'ai-chat-api-contract.md',
  'API-BARCODE-SCAN-PHONE-BRIDGE.md',
  'ai-failure-diagnosis-playbooks.md'
];

function safeReadFile(fullPath) {
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch (_err) {
    return null;
  }
}

async function retrieveKnowledgeSnippets({ query }) {
  // Minimal first pass: just load a small set of static docs.
  // A future iteration can use embeddings + pgvector for semantic retrieval.
  const lowerQuery = (query || '').toLowerCase();

  const snippets = [];

  for (const file of CANDIDATE_FILES) {
    const fullPath = path.join(DOCS_DIR, file);
    const content = safeReadFile(fullPath);
    if (!content) continue;

    // Always include application knowledge so the AI has app context for any question.
    if (file === 'APPLICATION-KNOWLEDGE-FOR-AI.md') {
      snippets.push({ source: file, content });
      continue;
    }

    // Very naive relevance check: include file if query or file contains relevant keywords.
    const haystack = content.toLowerCase();
    const isRelevant =
      !lowerQuery ||
      lowerQuery.includes('work order') ||
      lowerQuery.includes('maintenance') ||
      lowerQuery.includes('parts') ||
      lowerQuery.includes('inventory') ||
      lowerQuery.includes('barcode') ||
      lowerQuery.includes('scan') ||
      lowerQuery.includes('integration') ||
      lowerQuery.includes('onboard') ||
      haystack.includes('work order') ||
      haystack.includes('maintenance') ||
      haystack.includes('parts') ||
      haystack.includes('inventory') ||
      haystack.includes('barcode') ||
      haystack.includes('integration') ||
      haystack.includes('driver') ||
      haystack.includes('onboarding');

    if (isRelevant) {
      snippets.push({
        source: file,
        content
      });
    }
  }

  return snippets;
}

module.exports = {
  retrieveKnowledgeSnippets
};

