import Anthropic from '@anthropic-ai/sdk';

let cachedAnthropicClient: Anthropic | null = null;

export function getAnthropicClient() {
  if (cachedAnthropicClient) return cachedAnthropicClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
  }

  cachedAnthropicClient = new Anthropic({ apiKey });
  return cachedAnthropicClient;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const client = getAnthropicClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg';
    data: string;
  };
}

export interface TextContent {
  type: 'text';
  text: string;
}

export async function analyzeImage(
  imageData: string,
  prompt: string,
  mediaType: 'image/png' | 'image/jpeg' = 'image/png'
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageData,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type === 'text') {
    return content.text;
  }

  throw new Error('Unexpected response type from Claude');
}

export async function analyzeMultipleImages(
  images: Array<{ data: string; mediaType: 'image/png' | 'image/jpeg' }>,
  prompt: string
): Promise<string> {
  const content: Array<ImageContent | TextContent> = [];

  images.forEach((image) => {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data,
      },
    });
  });

  content.push({
    type: 'text',
    text: prompt,
  });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  });

  const responseContent = message.content[0];
  if (responseContent.type === 'text') {
    return responseContent.text;
  }

  throw new Error('Unexpected response type from Claude');
}

export async function analyzePDF(
  pdfBase64: string,
  prompt: string
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          } as any,
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type === 'text') {
    return content.text;
  }

  throw new Error('Unexpected response type from Claude');
}
