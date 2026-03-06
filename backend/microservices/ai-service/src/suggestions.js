function buildSuggestions({ message, context }) {
  const suggestions = [];
  const lower = (message || '').toLowerCase();
  const route = (context && context.route) || '';

  const wantsWorkOrder =
    lower.includes('work order') ||
    lower.includes('work-order') ||
    lower.includes('create wo') ||
    route.includes('work-order');

  if (wantsWorkOrder) {
    const assetId = context?.selectedEntityIds?.vehicleId || null;

    suggestions.push({
      id: `sugg_work_order_draft_${Date.now()}`,
      type: 'workOrderDraft',
      title: 'Create work order draft',
      description: 'Open a work order form prefilled from your question.',
      payload: {
        assetId,
        title: 'New work order',
        description: message,
        priority: 'medium',
        dueDate: null,
        tasks: []
      }
    });

    suggestions.push({
      id: `sugg_nav_work_order_${Date.now()}`,
      type: 'navigation',
      title: 'Go to Work Orders',
      description: 'Open the work orders screen to review or create this draft.',
      payload: {
        targetScreen: 'work-order',
        params: {
          assetId
        }
      }
    });
  }

  const wantsParts =
    lower.includes('part') ||
    lower.includes('parts catalog') ||
    lower.includes('inventory') ||
    route.includes('parts') ||
    route.includes('inventory');

  if (wantsParts) {
    suggestions.push({
      id: `sugg_nav_parts_${Date.now()}`,
      type: 'navigation',
      title: 'Open Parts Catalog',
      description: 'Jump to the parts catalog to search or reserve parts.',
      payload: {
        targetScreen: 'parts',
        params: {}
      }
    });
  }

  return suggestions;
}

module.exports = {
  buildSuggestions
};

