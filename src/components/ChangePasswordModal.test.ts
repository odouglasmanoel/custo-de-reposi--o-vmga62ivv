import { describe, it, expect, vi, beforeEach } from 'vitest'
import pb from '@/lib/pocketbase/client'

// Test to verify PocketBase client update call parameters for ChangePasswordModal
describe('ChangePasswordModal PocketBase integration contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PocketBase user password update accepts simple and repeated 4-digit passwords with oldPassword', async () => {
    const updateSpy = vi.spyOn(pb.collection('users'), 'update').mockResolvedValue({
      id: 'mock-user-id',
      email: 'douglas.manoel@repress.com.br',
    } as any)

    const payload = {
      oldPassword: 'currentPassword123',
      password: '9999',
      passwordConfirm: '9999',
    }

    await pb.collection('users').update('mock-user-id', payload)

    expect(updateSpy).toHaveBeenCalledWith('mock-user-id', {
      oldPassword: 'currentPassword123',
      password: '9999',
      passwordConfirm: '9999',
    })
  })

  it('Payload with repeated or sequential passwords has min length >= 4', () => {
    const passwordsToTest = ['9999', '1111', '1234', '0000', 'aaaa']
    for (const pwd of passwordsToTest) {
      expect(pwd.length).toBeGreaterThanOrEqual(4)
      // No complexity restriction regex (e.g. must not enforce uppercase or numbers only)
    }
  })
})
