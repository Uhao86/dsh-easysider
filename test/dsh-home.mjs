#!/usr/bin/env node
/**
 * Build a throwaway DSH_HOME for tests that behaves like the `dsh web`
 * environment (same credentials) but keeps sessions and caches inside the
 * test runtime directory, so no test writes to ~/.dsh.
 */
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function prepareTestDshHome(parentDir) {
  const home = join(parentDir, 'dsh-home')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })

  const credentials = join(homedir(), '.dsh', '.credentials.yaml')
  if (existsSync(credentials)) {
    try { symlinkSync(credentials, join(home, '.credentials.yaml')) } catch { /* copy not needed */ }
  }
  writeFileSync(join(home, '.anonymous-user-id'), 'dsh-sidebar-test\n')
  mkdirSync(join(home, 'sessions'), { recursive: true })
  mkdirSync(join(home, 'storages'), { recursive: true })

  // Reuse the real sdk profile (and its installed plugins, e.g. intelligent-ui)
  // so tests exercise the same composition without touching ~/.dsh sessions.
  const sourceProfile = join(homedir(), '.dsh', 'profiles', 'sdk')
  if (existsSync(sourceProfile)) {
    try { cpSync(sourceProfile, join(home, 'profiles', 'sdk'), { recursive: true, force: true }) } catch { /* fresh profile is fine */ }
  }
  return home
}
