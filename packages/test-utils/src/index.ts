export interface TestUserFactoryInput {
  email: string;
  name: string;
}

export function makeTestUser(input: TestUserFactoryInput) {
  return {
    id: `user_${input.email}`,
    email: input.email,
    name: input.name
  };
}
