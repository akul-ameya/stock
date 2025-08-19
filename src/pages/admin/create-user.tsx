import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { useAdminProtection } from '../../hooks/useAuth'

export default function CreateUser() {
  let cf_url = '';
  try {
    // @ts-ignore
    cf_url = require('../../../public/cf_url.json').cf_url;
  } catch {}
  const [username, setUsername] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [usernameError, setUsernameError] = useState<string>('')
  const [users, setUsers] = useState<Array<{id: number, username: string, is_admin: boolean, display_type: string, is_self: boolean}>>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(true)
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null)
  const [deleteUsername, setDeleteUsername] = useState<string>('')
  const [isDeleting, setIsDeleting] = useState<boolean>(false)
  const [changePassUserId, setChangePassUserId] = useState<number | null>(null)
  const [changePassUsername, setChangePassUsername] = useState<string>('')
  const [newPassword, setNewPassword] = useState<string>('')
  const [currentPassword, setCurrentPassword] = useState<string>('')
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false)
  const [currentUserIsRoot, setCurrentUserIsRoot] = useState<boolean>(false)
  const [showRoleDropdown, setShowRoleDropdown] = useState<boolean>(false)
  const [roleDropdownIndex, setRoleDropdownIndex] = useState<number>(-1)
  const roleDropdownRef = useRef<HTMLDivElement>(null)
  const [searchUsername, setSearchUsername] = useState<string>('')
  const [sortAscending, setSortAscending] = useState<boolean>(true)
  const [typeFilter, setTypeFilter] = useState<string>('All')
  const router = useRouter()

  // Protect admin route
  useAdminProtection()

  // Fetch users when component mounts
  useEffect(() => {
    fetchUsers()
    // Check if current user is root admin
    const token = localStorage.getItem('token')
    if (token) {
      // Simple way to check - we can decode the token or make an API call
      // For now, we'll set it based on login response stored in localStorage
      const isRoot = localStorage.getItem('username') === 'admin'
      setCurrentUserIsRoot(isRoot)
    }
  }, [])

  // Handle clicks outside role dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setShowRoleDropdown(false)
        setRoleDropdownIndex(-1)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const fetchUsers = async () => {
    setIsLoadingUsers(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${cf_url}/get-users`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (res.ok) {
        const data = await res.json()
        setUsers(data.users)
      } else {
        console.error('Failed to fetch users')
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    } finally {
      setIsLoadingUsers(false)
    }
  }

  const handleCreate = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password')
      return
    }
    setIsLoading(true)
    setError('')
    setSuccess('')
    setUsernameError('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${cf_url}/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          username, 
          password, 
          is_admin: role === 'admin' 
        })
      })
      if (res.ok) {
        const successData = await res.json()
        setSuccess(successData.status || `User "${username}" created successfully!`)
        setUsername('')
        setPassword('')
        setRole('user')
        setError('')
        setUsernameError('')
        fetchUsers()
      } else {
        const errorData = await res.json()
        const errorMessage = errorData.error || 'Failed to create user'
        if (errorMessage.includes('already exists')) {
          setUsernameError(errorMessage)
          setError('')
        } else {
          setError(errorMessage)
          setUsernameError('')
        }
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate()
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    router.push('/user/login')
  }

  const handleDeleteUser = async () => {
    if (!deleteUserId) return
    setIsDeleting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${cf_url}/delete-user`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ user_id: deleteUserId })
      })
      if (res.ok) {
        const data = await res.json()
        setSuccess(data.status)
        setError('')
        fetchUsers()
      } else {
        const errorData = await res.json()
        setError(errorData.error || 'Failed to delete user')
        setSuccess('')
      }
    } catch (err) {
      setError('Network error. Please try again.')
      setSuccess('')
    } finally {
      setIsDeleting(false)
      setDeleteUserId(null)
      setDeleteUsername('')
    }
  }

  const confirmDelete = (userId: number, username: string) => {
    setDeleteUserId(userId)
    setDeleteUsername(username)
  }

  const cancelDelete = () => {
    setDeleteUserId(null)
    setDeleteUsername('')
  }

  const confirmChangePassword = (userId: number, username: string) => {
    setChangePassUserId(userId)
    setChangePassUsername(username)
    setNewPassword('')
    setCurrentPassword('')
  }

  const cancelChangePassword = () => {
    setChangePassUserId(null)
    setChangePassUsername('')
    setNewPassword('')
    setCurrentPassword('')
  }

  const handleChangePassword = async () => {
    if (!changePassUserId || !newPassword.trim()) {
      setError('New password is required')
      return
    }

    if (!currentUserIsRoot && !currentPassword.trim()) {
      setError('Current password is required')
      return
    }

    setIsChangingPassword(true)
    try {
      const token = localStorage.getItem('token')
      const requestBody: any = {
        user_id: changePassUserId,
        new_password: newPassword
      }

      if (!currentUserIsRoot) {
        requestBody.current_password = currentPassword
      }

      const res = await fetch(`${cf_url}/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })

      if (res.ok) {
        const data = await res.json()
        setSuccess(data.status)
        setError('')
        cancelChangePassword()
      } else {
        const errorData = await res.json()
        setError(errorData.error || 'Failed to change password')
        setSuccess('')
      }
    } catch (err) {
      setError('Network error. Please try again.')
      setSuccess('')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleRoleSelect = (selectedRole: 'user' | 'admin') => {
    setRole(selectedRole)
    setShowRoleDropdown(false)
    setRoleDropdownIndex(-1)
  }

  const handleRoleKeyDown = (e: React.KeyboardEvent) => {
    const roles = ['user', 'admin']
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setRoleDropdownIndex(prev => prev < roles.length - 1 ? prev + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setRoleDropdownIndex(prev => prev > 0 ? prev - 1 : roles.length - 1)
    } else if (e.key === 'Enter' && roleDropdownIndex >= 0) {
      e.preventDefault()
      handleRoleSelect(roles[roleDropdownIndex] as 'user' | 'admin')
    } else if (e.key === 'Escape') {
      setShowRoleDropdown(false)
      setRoleDropdownIndex(-1)
    }
  }

  const handleSortToggle = () => {
    setSortAscending(!sortAscending)
  }

  const handleTypeFilterCycle = () => {
    if (typeFilter === 'All') {
      setTypeFilter('Admin')
    } else if (typeFilter === 'Admin') {
      setTypeFilter('User')
    } else {
      setTypeFilter('All')
    }
  }

  // Filter and sort users
  const filteredAndSortedUsers = users
    .filter(user => {
      // Username search filter
      const matchesUsername = user.username.toLowerCase().includes(searchUsername.toLowerCase())
      
      // Type filter
      let matchesType = true
      if (typeFilter === 'Admin') {
        matchesType = user.is_admin || user.display_type === 'Root' || user.display_type === 'Self'
      } else if (typeFilter === 'User') {
        matchesType = !user.is_admin && user.display_type !== 'Root' && user.display_type !== 'Self'
      }
      
      return matchesUsername && matchesType
    })
    .sort((a, b) => {
      // Priority sorting: Self first, then Root, then other admins, then users
      const getPriority = (user: any) => {
        if (user.is_self) return 0
        if (user.display_type === 'Root') return 1
        if (user.is_admin) return 2
        return 3
      }
      
      const priorityA = getPriority(a)
      const priorityB = getPriority(b)
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }
      
      // Within same priority, sort alphabetically
      const nameA = a.username.toLowerCase()
      const nameB = b.username.toLowerCase()
      
      if (sortAscending) {
        return nameA.localeCompare(nameB)
      } else {
        return nameB.localeCompare(nameA)
      }
    })

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 font-sans flex flex-col">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 w-full bg-white/90 backdrop-blur border-b border-gray-200 shadow z-10 flex items-center justify-between px-8 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-extrabold tracking-tight text-blue-800">Admin Panel</span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => window.open('/user/query', '_blank')}
            className="border border-blue-600 text-blue-600 bg-white px-4 py-1.5 rounded-md font-medium hover:bg-blue-600 hover:text-white focus:ring-2 focus:ring-blue-200 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Query Data
          </button>
          <button 
            onClick={handleLogout}
            className="border border-red-600 text-red-600 bg-white px-4 py-1.5 rounded-md font-medium hover:bg-red-600 hover:text-white focus:ring-2 focus:ring-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="w-full max-w-7xl mx-auto pt-28 pb-8 px-4 flex-1">
        

        {/* Success/Error Messages */}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm max-w-4xl mx-auto">
            {success}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm max-w-4xl mx-auto">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Half - Create User */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Create New User</h2>
          {/* Create User Form */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700">
                Username
              </label>
              <input
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={e => {
                  setUsername(e.target.value)
                  // Clear username error when user starts typing a new username
                  if (usernameError) {
                    setUsernameError('')
                  }
                }}
                onKeyPress={handleKeyPress}
                className={`w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-colors ${
                  usernameError ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
                disabled={isLoading}
              />
              {usernameError && (
                <p className="text-red-600 text-xs mt-1">{usernameError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700">
                Password
              </label>
              <input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-colors"
                disabled={isLoading}
              />
            </div>

            <div className="flex gap-4">
              {/* User Role - Left Half */}
              <div className="flex-1 flex flex-col justify-center">
                <label className="block text-sm font-semibold mb-2 text-gray-700">
                  User Role
                </label>
                <div className="relative" ref={roleDropdownRef}>
                  <div
                    className="w-full border border-gray-300 rounded p-2 h-[40px] text-sm focus:ring-2 focus:ring-blue-200 transition-colors bg-white cursor-pointer flex items-center justify-between"
                    onClick={() => {
                      if (!isLoading) {
                        setShowRoleDropdown(!showRoleDropdown)
                        setRoleDropdownIndex(-1)
                      }
                    }}
                    onKeyDown={handleRoleKeyDown}
                    tabIndex={0}
                  >
                    <span className={role === 'user' ? 'text-gray-900' : 'text-gray-900'}>
                      {role === 'user' ? 'User' : 'Admin'}
                    </span>
                    <svg 
                      className={`w-4 h-4 transition-transform ${showRoleDropdown ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {showRoleDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden">
                      <div
                        className={`p-2 cursor-pointer text-sm rounded-t-lg ${
                          roleDropdownIndex === 0 ? 'bg-blue-100' : 'hover:bg-blue-50'
                        }`}
                        onMouseDown={() => handleRoleSelect('user')}
                        onMouseEnter={() => setRoleDropdownIndex(0)}
                      >
                        User
                      </div>
                      <div
                        className={`p-2 cursor-pointer text-sm rounded-b-lg ${
                          roleDropdownIndex === 1 ? 'bg-blue-100' : 'hover:bg-blue-50'
                        }`}
                        onMouseDown={() => handleRoleSelect('admin')}
                        onMouseEnter={() => setRoleDropdownIndex(1)}
                      >
                        Admin
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Create User Button - Right Half */}
              <div className="flex-1 flex items-center">
                <div className="w-full">
                  <label className="block text-sm font-semibold mb-2 text-gray-700">
                    &nbsp;
                  </label>
                  <button
                    onClick={handleCreate}
                    disabled={isLoading || !username.trim() || !password.trim()}
                    className="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-[40px] cursor-pointer"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Creating User...</span>
                      </div>
                    ) : (
                      'Create User'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* Additional Info */}
          <div className="mt-6 pt-4 border-t border-gray-100">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-blue-800 mb-2">User Access Levels:</h3>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• <strong>Regular Users:</strong> Can access the query interface</li>
                <li>• <strong>Administrators:</strong> Can create/delete users and access all features</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Right Half - Manage Users */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Existing Users</h2>
          {isLoadingUsers ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : (
            <div className="flex flex-col h-96">
              {/* Fixed Header */}
              <div className="flex-shrink-0 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-3 px-2 font-semibold text-gray-700 w-1/3">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Username"
                            value={searchUsername}
                            onChange={(e) => setSearchUsername(e.target.value)}
                            className="w-full border-none outline-none px-2 py-1 text-xs bg-transparent text-gray-700 font-semibold placeholder-gray-700"
                          />
                          <button
                            onClick={handleSortToggle}
                            className="flex-shrink-0 p-1 hover:bg-gray-200 rounded transition-colors"
                            title={`Sort ${sortAscending ? 'descending' : 'ascending'}`}
                          >
                            <svg 
                              className={`w-4 h-4 transition-transform ${sortAscending ? '' : 'rotate-180'}`} 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-gray-700 w-1/4">
                        <span 
                          className="cursor-pointer hover:text-blue-600 transition-colors select-none"
                          onClick={handleTypeFilterCycle}
                        >
                          Type ({typeFilter})
                        </span>
                      </th>
                      <th className="text-center py-3 px-2 font-semibold text-gray-700 w-5/12">Actions</th>
                    </tr>
                  </thead>
                </table>
              </div>
              
              {/* Scrollable Body */}
              <div className="flex-1 overflow-auto scrollbar-hide">
                <table className="w-full">
                  <tbody>
                    {filteredAndSortedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-gray-500">
                          {searchUsername || typeFilter !== 'All' ? 'No users found' : 'No users found'}
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedUsers.map((user) => (
                        <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-2 text-sm w-1/3">{user.username}</td>
                          <td className="py-3 px-2 w-1/4">
                            <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                              user.display_type === 'Root' || user.display_type === 'Self'
                                ? 'bg-green-100 text-green-800'
                                : user.display_type === 'Admin'
                                  ? 'bg-purple-100 text-purple-800' 
                                  : user.display_type === 'User'
                                    ? 'bg-gray-100 text-gray-800'
                                    : user.is_admin 
                                      ? 'bg-purple-100 text-purple-800'
                                      : 'bg-gray-100 text-gray-800'
                            }`}>
                              {user.display_type || (user.is_admin ? 'Admin' : 'User')}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-center w-5/12">
                            <div className="flex gap-2 justify-center">
                              <button
                                onClick={() => confirmChangePassword(user.id, user.username)}
                                disabled={!currentUserIsRoot && user.is_admin}
                                className="bg-blue-500 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-600 focus:ring-2 focus:ring-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold cursor-pointer"
                                title={
                                  !currentUserIsRoot && user.is_admin 
                                    ? 'Cannot change password for other admins' 
                                    : 'Change password'
                                }
                              >
                                Change Pass
                              </button>
                              <button
                                onClick={() => confirmDelete(user.id, user.username)}
                                disabled={user.username === 'admin' || (!currentUserIsRoot && user.is_admin)}
                                className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs hover:bg-red-600 focus:ring-2 focus:ring-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold cursor-pointer"
                                title={
                                  user.username === 'admin' 
                                    ? 'Cannot delete main admin user' 
                                    : (!currentUserIsRoot && user.is_admin)
                                      ? 'Only root admin can delete other admins'
                                      : 'Delete user'
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteUserId && (
        <div 
          className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={cancelDelete}
        >
          <div 
            className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Confirm Deletion</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete the user <strong>&quot;{deleteUsername}&quot;</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={isDeleting}
                className="px-4 py-2 text-white bg-red-500 rounded-lg hover:bg-red-600 focus:ring-2 focus:ring-red-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold"
              >
                {isDeleting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Deleting...</span>
                  </div>
                ) : (
                  'Delete User'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {changePassUserId && (
        <div 
          className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={cancelChangePassword}
        >
          <div 
            className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Change Password</h3>
            <p className="text-gray-600 mb-4">
              Change password for user <strong>&quot;{changePassUsername}&quot;</strong>
            </p>
            <div className="space-y-4 mb-6">
              {!currentUserIsRoot && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                    placeholder="Enter current password"
                    disabled={isChangingPassword}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                  placeholder="Enter new password"
                  disabled={isChangingPassword}
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelChangePassword}
                disabled={isChangingPassword}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={isChangingPassword || !newPassword.trim() || (!currentUserIsRoot && !currentPassword.trim())}
                className="px-4 py-2 text-white bg-blue-500 rounded-lg hover:bg-blue-600 focus:ring-2 focus:ring-blue-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold"
              >
                {isChangingPassword ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Changing...</span>
                  </div>
                ) : (
                  'Change Password'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  )
}