export interface MockOpenAIResponse {
  output_text: string | null;
}

export interface MockOpenAIState {
  response: MockOpenAIResponse | null;
  error: Error | null;
}

export function createMockOpenAIState(): MockOpenAIState {
  return {
    response: { output_text: 'This is a test response from AI.' },
    error: null,
  };
}

export function createMockOpenAI(state: MockOpenAIState) {
  return {
    responses: {
      create: async (): Promise<MockOpenAIResponse> => {
        if (state.error) {
          throw state.error;
        }
        if (!state.response) {
          return { output_text: null };
        }
        return state.response;
      },
    },
  };
}
