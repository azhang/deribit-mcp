import { inputRequired, acceptedContent } from '@modelcontextprotocol/server';
import { fail } from './format.js';

const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';

/** Whether the calling client can show the user an elicitation form, on either protocol era. */
export function canElicit(server, ctx) {
  const modern = ctx?.mcpReq?.envelope?.[CAPABILITIES_KEY];
  const caps = modern ?? server.server.getClientCapabilities?.();
  return Boolean(caps?.elicitation);
}

/**
 * Gate a state-changing action on a human decision.
 *
 * - Clients that support elicitation get a confirmation form showing exactly what will run.
 *   A model-supplied `confirm: true` does not skip it.
 * - Other clients get an error asking the model to get the user's approval in the chat and
 *   call again with `confirm: true`.
 *
 * @returns {Promise<null | object>} null when confirmed (go ahead), otherwise the result to return.
 */
export function requireConfirmation(server, ctx, { summary, confirm }) {
  if (canElicit(server, ctx)) {
    // No response yet → ask. Any response (accepted, declined, cancelled) → decide; asking
    // again after a decline would loop until the client gives up.
    if (ctx.mcpReq.inputResponses?.confirm === undefined) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `${summary}\n\nThis changes your Deribit account. Proceed?`,
            requestedSchema: {
              type: 'object',
              properties: { confirm: { type: 'boolean', title: 'Proceed', description: summary } },
              required: ['confirm'],
            },
          }),
        },
      });
    }
    const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm');
    return answer?.confirm === true ? null : fail('Cancelled: the user did not confirm.');
  }
  if (confirm === true) return null;
  return fail(
    `Not run. ${summary}\n\nThis changes the user's Deribit account. Show the user exactly this action, ` +
    'get their explicit approval in the conversation, then call again with confirm: true.',
  );
}
