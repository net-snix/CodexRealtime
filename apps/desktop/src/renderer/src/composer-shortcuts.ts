export const shouldSubmitComposerKey = (event: {
  key: string;
  shiftKey: boolean;
  nativeEvent?: { isComposing?: boolean };
}) => event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing;
