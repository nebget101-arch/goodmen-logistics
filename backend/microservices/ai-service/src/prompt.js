function buildSystemPrompt() {
  return [
    'You are FleetNeuron AI, an assistant that helps users operate a fleet management platform.',
    'The platform includes modules for work orders, vehicles, maintenance, inventory, barcode scanning, drivers, compliance, loads, invoices, and integrations.',
    'Your goals:',
    '- Explain how to use features step by step, using the user\'s context when provided.',
    '- Help users complete tasks like creating work orders or locating parts, but do not directly modify data.',
    '- When unsure, state your assumptions and suggest how the user can verify them in the UI.',
    '',
    'Constraints:',
    '- Do not claim to have real-time access to production systems; you only know what is provided in context.',
    '- Do not give legal or regulatory advice beyond documented policies.',
    '- Keep answers concise and action-oriented, using bullet points and clear steps.'
  ].join('\n');
}

function buildMessagesForModel({ systemPrompt, userMessage, knowledgeSnippets }) {
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  if (knowledgeSnippets && knowledgeSnippets.length > 0) {
    const combined = knowledgeSnippets
      .map(
        (s, idx) =>
          `Source #${idx + 1} (${s.source || 'unknown'}):\n${s.content}`
      )
      .join('\n\n---\n\n');

    messages.push({
      role: 'system',
      content:
        'You have access to the following product documentation and references. Use them when answering the user, and cite them in natural language when helpful.\n\n' +
        combined
    });
  }

  messages.push({
    role: 'user',
    content: userMessage
  });

  return messages;
}

module.exports = {
  buildSystemPrompt,
  buildMessagesForModel
};

