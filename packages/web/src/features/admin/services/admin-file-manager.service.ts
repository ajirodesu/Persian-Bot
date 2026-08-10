/**
 * Admin File Manager Service — the GitHub-native repository file manager.
 *
 * Talks to /api/v1/admin/files, which operates DIRECTLY on the configured
 * GitHub repository (Contents/Trees/Commits APIs). Every mutation is a real
 * commit pushed to the repo's default branch — no local disk involved.
 */

import apiClient from '@/lib/api-client.lib'

// ── DTOs ───────────────────────────────────────────────────────────────────────

export interface RepoLastCommitDto {
  message: string
  author: string
  /** ISO timestamp of the last commit touching the entry. */
  date: string
}

export interface RepoEntryDto {
  name: string
  /** Path relative to the repository root, e.g. `packages/cat-bot/src/app`. */
  path: string
  type: 'folder' | 'file'
  /** File size in bytes; null for folders. */
  size: number | null
  sha: string
  lastCommit: RepoLastCommitDto | null
  /** Detected language key for editor highlighting; set after the file is read. */
  language?: string | null
}

export interface RepoDirectoryListingDto {
  /** The path that was listed ('' for the repository root). */
  path: string
  entries: RepoEntryDto[]
}

export interface RepoMetaDto {
  owner: string
  repo: string
  branch: string
  configured: boolean
}

export interface RepoReadFileDto {
  path: string
  content: string
  language: string | null
  size: number | null
  sha: string
}

export interface RepoMutationResultDto {
  synced: boolean
  commitSha?: string
}

export class AdminFileManagerService {
  // GET /api/v1/admin/files/meta — repo identity + default branch + configured
  async getMeta(): Promise<RepoMetaDto> {
    const response = await apiClient.get<RepoMetaDto>('/api/v1/admin/files/meta')
    return response.data
  }

  // GET /api/v1/admin/files?path=packages — list a folder ('' = repo root)
  async listFiles(dir: string): Promise<RepoDirectoryListingDto> {
    const response = await apiClient.get<RepoDirectoryListingDto>(
      '/api/v1/admin/files',
      { params: { path: dir } },
    )
    return response.data
  }

  // GET /api/v1/admin/files/content?path=README.md — read a file
  async getFileContent(path: string): Promise<RepoReadFileDto> {
    const response = await apiClient.get<RepoReadFileDto>(
      '/api/v1/admin/files/content',
      { params: { path } },
    )
    return response.data
  }

  // POST /api/v1/admin/files — create a file or folder (committed to the repo)
  async createFileEntry(
    path: string,
    type: 'file' | 'folder',
    content = '',
    message?: string,
  ): Promise<RepoMutationResultDto> {
    const response = await apiClient.post<RepoMutationResultDto>(
      '/api/v1/admin/files',
      { path, type, content, ...(message ? { message } : {}) },
    )
    return response.data
  }

  // PUT /api/v1/admin/files — overwrite a file and commit it
  async saveFile(
    path: string,
    content: string,
    message: string,
  ): Promise<RepoMutationResultDto> {
    const response = await apiClient.put<RepoMutationResultDto>(
      '/api/v1/admin/files',
      { path, content, message },
    )
    return response.data
  }

  // PUT /api/v1/admin/files/rename — move a file or folder (committed)
  async renameFileEntry(
    from: string,
    to: string,
    message?: string,
  ): Promise<RepoMutationResultDto> {
    const response = await apiClient.put<RepoMutationResultDto>(
      '/api/v1/admin/files/rename',
      { from, to, ...(message ? { message } : {}) },
    )
    return response.data
  }

  // DELETE /api/v1/admin/files?path=foo.ts — delete a file or folder (committed)
  async deleteFileEntry(path: string, message?: string): Promise<RepoMutationResultDto> {
    const response = await apiClient.delete<RepoMutationResultDto>(
      '/api/v1/admin/files',
      { params: { path, ...(message ? { message } : {}) } },
    )
    return response.data
  }
}

export const adminFileManagerService = new AdminFileManagerService()
