import { http } from './http'

export interface CurrentUser {
  id: number
  user_name: string
  role: 'ADMIN' | 'MEMBER'
  created_at: string
  last_login_at: string | null
}

export interface LoginRequest {
  user_name: string
  password: string
}

export interface UserDto {
  id: number
  user_name: string
  role: 'ADMIN' | 'MEMBER'
  enabled: boolean
  created_at: string
  last_login_at: string | null
}

export interface UserPayload {
  user_name: string
  password: string
  role: 'ADMIN' | 'MEMBER'
}

export interface UserPatch {
  role?: 'ADMIN' | 'MEMBER'
  enabled?: boolean
}

export interface ChangePasswordPayload {
  old_password: string
  new_password: string
}

export const iamApi = {
  me: () => http.get<CurrentUser>('/api/iam/me'),
  login: (body: LoginRequest) => http.post<CurrentUser>('/api/iam/login', body),
  logout: () => http.post<null>('/api/iam/logout'),
  changePassword: (body: ChangePasswordPayload) => http.post<null>('/api/iam/me/password', body),
  listUsers: () => http.get<UserDto[]>('/api/iam/users'),
  createUser: (body: UserPayload) => http.post<UserDto>('/api/iam/users', body),
  updateUser: (id: number, body: UserPatch) => http.patch<UserDto>(`/api/iam/users/${id}`, body),
  resetPassword: (id: number, password: string) =>
    http.post<null>(`/api/iam/users/${id}/reset-password`, { password }),
  deleteUser: (id: number) => http.delete<null>(`/api/iam/users/${id}`),
}
