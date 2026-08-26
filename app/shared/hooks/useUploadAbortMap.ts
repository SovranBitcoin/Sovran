import { useEffect, useRef } from 'react';

/**
 * The caller-owned abort map for `uploadMediaBlocks`: AbortControllers for
 * in-flight uploads keyed by media-block id, so removing a block cancels its
 * upload instead of orphaning a blob on the server — plus the guarantee both
 * composing surfaces were hand-copying: any upload still running when the
 * component unmounts mid-post is aborted.
 */
export function useUploadAbortMap(): React.RefObject<Map<string, AbortController>> {
  const uploadsRef = useRef<Map<string, AbortController>>(new Map());
  useEffect(() => {
    const uploads = uploadsRef.current;
    return () => {
      uploads.forEach((controller) => controller.abort());
      uploads.clear();
    };
  }, []);
  return uploadsRef;
}
