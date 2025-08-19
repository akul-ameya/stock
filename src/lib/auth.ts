export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function clearToken(): void {
  localStorage.removeItem('token')
  localStorage.removeItem('userRole')
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function setUserRole(isAdmin: boolean): void {
  localStorage.setItem('userRole', isAdmin ? 'admin' : 'user')
}

export function getUserRole(): 'admin' | 'user' | null {
  const role = localStorage.getItem('userRole')
  return role as 'admin' | 'user' | null
}

export function isAdmin(): boolean {
  return getUserRole() === 'admin'
}

export function isUser(): boolean {
  return getUserRole() === 'user'
}