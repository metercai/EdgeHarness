/**
 * React hooks for file uploads
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  deleteUploadedFile,
  listUploadedFiles,
  uploadFiles,
  type UploadedFileInfo,
  type UploadResponse,
} from "./api";

/**
 * Hook to upload files
 */
export function useUploadFiles(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation<UploadResponse, Error, File[]>({
    mutationFn: (files: File[]) => uploadFiles(threadId, files),
    onSuccess: () => {
      // Invalidate the uploaded files list
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "list", threadId],
      });
    },
  });
}

/**
 * Hook to list uploaded files
 */
export function useUploadedFiles(threadId: string) {
  return useQuery({
    queryKey: ["uploads", "list", threadId],
    queryFn: () => listUploadedFiles(threadId),
    enabled: !!threadId,
  });
}

/**
 * Hook to delete an uploaded file
 */
export function useDeleteUploadedFile(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filename: string) => deleteUploadedFile(threadId, filename),
    onSuccess: () => {
      // Invalidate the uploaded files list
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "list", threadId],
      });
    },
  });
}

/**
 * Hook to handle file uploads in submit flow
 * Returns a function that uploads files and waits for markdown conversion
 * 
 * Workflow:
 * 1. Upload files (backend returns immediately)
 * 2. Poll list endpoint until all files have markdown_file field
 * 3. Return complete file info with markdown paths
 */
export function useUploadFilesOnSubmit(threadId: string) {
  const uploadMutation = useUploadFiles(threadId);

  return useCallback(
    async (files: File[]): Promise<UploadedFileInfo[]> => {
      if (files.length === 0) {
        return [];
      }

      // Step 1: Upload files (non-blocking)
      const uploadResult = await uploadMutation.mutateAsync(files);
      const uploadedFilenames = uploadResult.files.map((f) => f.filename);
      
      // Check if any files need conversion
      const filesNeedingConversion = uploadResult.files.filter((f) => {
        const ext = f.extension?.toLowerCase() || f.filename.split(".").pop()?.toLowerCase();
        return ["pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx"].includes(ext || "");
      });

      if (filesNeedingConversion.length === 0) {
        // No conversion needed, return immediately
        return uploadResult.files;
      }

      // Step 2: Poll for markdown file completion
      const maxAttempts = 600; // 5 minutes at 1s intervals
      const pollInterval = 1000; // 1 second

      let listResult: Awaited<ReturnType<typeof listUploadedFiles>> | null = null;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          // Poll the list endpoint
          listResult = await listUploadedFiles(threadId);
          
          // Check if all files have markdown_file
          const allConverted = filesNeedingConversion.every((file) => {
            const listFile = listResult.files.find(
              (f) => f.filename === file.filename
            );
            return listFile?.markdown_file !== undefined;
          });

          if (allConverted) {
            // All files converted, return the full list with markdown info
            return listResult.files.filter((f) => 
              uploadedFilenames.includes(f.filename)
            );
          }
        } catch (error) {
          // If polling fails, return what we have
          console.error(`Error polling(${attempt + 1}) for file conversion:`, error);
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Timeout: return original upload result without markdown files
      console.warn(
        `File conversion timeout after ${maxAttempts * pollInterval / 1000}s. ` +
        `Files may not be fully processed.`
      );
      if (listResult) {
      	return listResult.files.filter((f) => 
              uploadedFilenames.includes(f.filename)
            );
      }
      return uploadResult.files;
    },
    [uploadMutation],
  );
}
