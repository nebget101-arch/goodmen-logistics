const { buildSystemPrompt, buildMessagesForModel } = require('../prompt');
const { retrieveKnowledgeSnippets } = require('../knowledge/retriever');
const { buildSuggestions } = require('../suggestions');
const { logAiInteraction } = require('../analytics/logger');

async function handleChat(req, res, deps) {
  try {
    const { openai } = deps;
    const { message, conversationId, context, clientMeta } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        code: 'AI_BAD_REQUEST'
      });
    }

    const systemPrompt = buildSystemPrompt();

    const knowledgeSnippets = await retrieveKnowledgeSnippets({
      query: message,
      context
    });

    const modelMessages = buildMessagesForModel({
      systemPrompt,
      userMessage: message,
      knowledgeSnippets
    });

    const startedAt = Date.now();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: modelMessages,
      temperature: 0.3
    });

    const processingTimeMs = Date.now() - startedAt;

    const choice = completion.choices[0];
    const aiContent = choice?.message?.content || '';

    const finalConversationId = conversationId || `conv_${Date.now()}`;

    const suggestions = buildSuggestions({ message, context: context || {} });

    const response = {
      conversationId: finalConversationId,
      messages: [
        {
          id: `msg_user_${Date.now()}`,
          role: 'user',
          content: message,
          createdAt: new Date(startedAt).toISOString()
        },
        {
          id: `msg_ai_${Date.now()}`,
          role: 'assistant',
          content: aiContent,
          createdAt: new Date().toISOString()
        }
      ],
      suggestions,
      meta: {
        model: completion.model,
        processingTimeMs,
        clientMeta: clientMeta || null
      }
    };

    logAiInteraction({
      userId: context?.user?.id,
      route: context?.route,
      message,
      conversationId: finalConversationId,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] chat error', err);

    logAiInteraction({
      userId: null,
      route: null,
      message: req.body?.message,
      conversationId: req.body?.conversationId || null,
      success: false,
      errorCode: 'AI_UNAVAILABLE',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI service unavailable',
      code: 'AI_UNAVAILABLE'
    });
  }
}

module.exports = {
  handleChat
};

