/**
 * Executes an async function within a requestAnimationFrame to improve UI responsiveness
 */
export const runWithAnimationFrame = <T extends any[]>(
  callback: Function,
  setIsSubmitting?: React.Dispatch<React.SetStateAction<boolean>>
) => {
  return async (...args: T) => {
    if (setIsSubmitting) {
      setIsSubmitting(true);
    }

    requestAnimationFrame(async () => {
      try {
        await callback(...args);
      } catch {
      } finally {
        if (setIsSubmitting) {
          setIsSubmitting(false);
        }
      }
    });
  };
};
