export const providerCommentsPlaceholder =
  "No provider comments have been generated yet. Review the prepared diff slice.";

export function isProviderCommentsPlaceholder(question: string) {
  return question.trim() === providerCommentsPlaceholder;
}

export function filterActionableQuestions(questions: string[]) {
  return questions.filter((question) => !isProviderCommentsPlaceholder(question));
}
