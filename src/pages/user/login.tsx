import { useState } from 'react';
import { useRouter } from 'next/router';
import { setUserRole } from '../../lib/auth';

export default function UserLogin() {
  let cf_url = '';
  try {
    // @ts-ignore
    cf_url = require('../../../public/cf_url.json').cf_url;
  } catch {}

  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const router = useRouter();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${cf_url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const resData = await res.json();
        localStorage.setItem('token', resData.token);
        localStorage.setItem('username', username);
        setUserRole(resData.is_admin);
        if (resData.is_admin) {
          router.push('/admin/create-user');
        } else {
          router.push('/user/query');
        }
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Login failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 font-sans flex items-center justify-center">
      <div className="w-full max-w-md mx-auto">
        {/* Login Card */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold tracking-tight text-blue-800 mb-2">
              Historical Data Portal
            </h1>
            <h2 className="text-lg font-semibold text-gray-700">User Login</h2>
            <p className="text-sm text-gray-500 mt-2">
              Enter your credentials to access the trading data
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}

          {/* Login Form */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700">
                Username
              </label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-colors"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700">
                Password
              </label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-colors"
                disabled={isLoading}
              />
            </div>

            <button
              onClick={handleLogin}
              disabled={isLoading || !username.trim() || !password.trim()}
              className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Signing in...</span>
                </div>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}