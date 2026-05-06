import assert from 'node:assert/strict';
import { stripQuotedEmailText } from '../lib/support/tickets';

const gmailWrappedReply = `I can help

On Wed, May 6, 2026 at 2:44 PM Support from rosendolopez2014@gmail.com <
onboarding@resend.dev> wrote:
> Prior support message`;

assert.equal(stripQuotedEmailText(gmailWrappedReply), 'I can help');

const gmailInlineReply = `Looks good.

On Wed, May 6, 2026 at 2:44 PM Support <onboarding@resend.dev> wrote:
Testing`;

assert.equal(stripQuotedEmailText(gmailInlineReply), 'Looks good.');

const outlookReply = `Here is the answer.

-----Original Message-----
From: Support <support@example.com>`;

assert.equal(stripQuotedEmailText(outlookReply), 'Here is the answer.');

const normalMessage = `On site we need to check the south wall.
Please send the marked screenshot.`;

assert.equal(stripQuotedEmailText(normalMessage), normalMessage);

console.log('support email cleaner tests passed');
