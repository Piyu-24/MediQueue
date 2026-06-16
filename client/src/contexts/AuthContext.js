import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { authAPI, tokenStorage } from '../services/api';
import { toast } from 'react-hot-toast';

const initialState = {
  user: null,
  token: tokenStorage.getToken(),
  loading: true,
  isAuthenticated: false,
  isLocked: false,
};

const authReducer = (state, action) => {
  switch (action.type) {
    case 'AUTH_START':
      return { ...state, loading: true };
    case 'AUTH_SUCCESS':
      return {
        ...state,
        loading: false,
        isAuthenticated: true,
        isLocked: false,
        user: action.payload.user,
        token: action.payload.token,
      };
    case 'AUTH_FAIL':
      return { ...state, loading: false, isAuthenticated: false, user: null, token: null, isLocked: false };
    case 'LOGOUT':
      return { ...state, loading: false, isAuthenticated: false, user: null, token: null, isLocked: false };
    case 'UPDATE_USER':
      return { ...state, user: { ...state.user, ...action.payload } };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'LOCK_SCREEN':
      return { ...state, isLocked: true };
    case 'UNLOCK_SCREEN':
      return { ...state, isLocked: false };
    default:
      return state;
  }
};

const AuthContext = createContext();

const getAuthPayload = (response) => response?.data?.data ?? response?.data ?? {};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const [isChecking, setIsChecking] = React.useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (isChecking) return;
      const token = tokenStorage.getToken();
      if (token) {
        try {
          setIsChecking(true);
          const response = await authAPI.getMe();
          if (response.data.success) {
            const authData = getAuthPayload(response);
            dispatch({
              type: 'AUTH_SUCCESS',
              payload: { user: authData.user ?? authData, token },
            });
          } else {
            throw new Error('Failed to authenticate');
          }
        } catch {
          tokenStorage.clearToken();
          dispatch({ type: 'AUTH_FAIL' });
        } finally {
          setIsChecking(false);
        }
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email, password) => {
    try {
      dispatch({ type: 'AUTH_START' });
      const response = await authAPI.login({ email, password });
      if (response.data.success) {
        const { user, token } = response.data;
        tokenStorage.setToken(token);
        dispatch({ type: 'AUTH_SUCCESS', payload: { user, token } });
        toast.success('Login successful!');
        return { success: true, user };
      } else {
        throw new Error(response.data.message || 'Login failed');
      }
    } catch (error) {
      dispatch({ type: 'AUTH_FAIL' });
      const message = error.response?.data?.message || error.message || 'Login failed';
      toast.error(message);
      return { success: false, message };
    }
  };

  const register = async (userData) => {
    try {
      dispatch({ type: 'AUTH_START' });
      const response = await authAPI.register(userData);
      if (response.data.success) {
        const authData = getAuthPayload(response);
        const { user, token } = authData;
        tokenStorage.setToken(token);
        dispatch({ type: 'AUTH_SUCCESS', payload: { user, token } });
        toast.success('Registration successful! Please check your email for verification.');
        return { success: true, user };
      } else {
        throw new Error(response.data.message || 'Registration failed');
      }
    } catch (error) {
      dispatch({ type: 'AUTH_FAIL' });
      console.error('Registration error:', error);
      const message = error.response?.data?.message || error.message || 'Registration failed';
      if (error.response?.data?.errors) {
        const errors = error.response.data.errors;
        const firstError = Array.isArray(errors) ? errors[0]?.msg || errors[0] : Object.values(errors)[0];
        toast.error(firstError || message);
      } else {
        toast.error(message);
      }
      return { success: false, message, errors: error.response?.data?.errors };
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      tokenStorage.clearToken();
      dispatch({ type: 'LOGOUT' });
      toast.success('Logged out successfully');
    }
  };

  const lockScreen = useCallback(() => {
    dispatch({ type: 'LOCK_SCREEN' });
  }, []);

  const unlockScreen = useCallback((newToken) => {
    if (newToken) tokenStorage.setToken(newToken);
    dispatch({ type: 'UNLOCK_SCREEN' });
  }, []);

  // Verifies password server-side and returns {success, token?, message?}
  const reAuthenticate = async (password) => {
    try {
      const response = await authAPI.reAuthenticate(password);
      if (response.data.success) {
        return { success: true, token: response.data.token };
      }
      return { success: false, message: response.data.message || 'Re-authentication failed' };
    } catch (error) {
      const message = error.response?.data?.message || 'Incorrect password';
      return { success: false, message };
    }
  };

  const updateUser = (userData) => {
    dispatch({ type: 'UPDATE_USER', payload: userData });
  };

  const refreshUser = async () => {
    try {
      const response = await authAPI.getMe();
      if (response.data.success) {
        const authData = getAuthPayload(response);
        dispatch({ type: 'UPDATE_USER', payload: authData.user ?? authData });
        return { success: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  };

  const forgotPassword = async (email) => {
    try {
      const response = await authAPI.forgotPassword({ email });
      if (response.data.success) {
        toast.success('Password reset link sent to your email');
        return { success: true };
      }
      throw new Error(response.data.message || 'Failed to send reset email');
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Failed to send reset email';
      toast.error(message);
      return { success: false, message };
    }
  };

  const resetPassword = async (token, password) => {
    try {
      const response = await authAPI.resetPassword(token, { password });
      if (response.data.success) {
        toast.success('Password reset successful! Please login with your new password.');
        return { success: true };
      }
      throw new Error(response.data.message || 'Password reset failed');
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Password reset failed';
      toast.error(message);
      return { success: false, message };
    }
  };

  const verifyEmail = async (token) => {
    try {
      const response = await authAPI.verifyEmail(token);
      if (response.data.success) {
        toast.success('Email verified successfully!');
        return { success: true };
      }
      throw new Error(response.data.message || 'Email verification failed');
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Email verification failed';
      toast.error(message);
      return { success: false, message };
    }
  };

  const value = {
    ...state,
    login,
    register,
    logout,
    lockScreen,
    unlockScreen,
    reAuthenticate,
    updateUser,
    refreshUser,
    forgotPassword,
    resetPassword,
    verifyEmail,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export default AuthContext;
