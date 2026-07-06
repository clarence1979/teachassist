export interface ProviderCredential {
  id: 'anthropic' | 'openai';
  apiKey: string;
  defaultModel?: string;
  availableModels?: string[];
}

export interface CredentialsUser {
  name: string;
  school: string;
}

export interface CredentialsPayload {
  providers: ProviderCredential[];
  user?: CredentialsUser;
  persistenceNamespace?: string;
}

export interface CredentialsMessage {
  type: 'PEDAGOGY_CREDENTIALS' | 'PEDAGOGY_CREDENTIALS_UPDATE';
  payload: CredentialsPayload;
}

export type Provider = 'anthropic' | 'openai';

export const DEFAULT_ANTHROPIC_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
  'claude-sonnet-4-7',
  'claude-haiku-4-5',
];

export const DEFAULT_OPENAI_MODELS = [
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
  'o3',
];
