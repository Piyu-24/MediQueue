import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { AuthProvider } from '../contexts/AuthContext';
import Login from '../pages/auth/Login';

// Mock the API module used by AuthContext
jest.mock('../services/api', () => ({
  authAPI: {
    login: jest.fn(),
    getMe: jest.fn()
  },
  tokenStorage: {
    getToken: jest.fn(() => null),
    setToken: jest.fn(),
    clearToken: jest.fn()
  }
}));

// Mock the toast notifications so we can check them and avoid side effects
jest.mock('react-hot-toast', () => ({
  toast: { success: jest.fn(), error: jest.fn() }
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate
}));

const renderLogin = () => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </BrowserRouter>
  );
};

describe('Login page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the login form', () => {
    renderLogin();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  test('logs in and redirects to the dashboard', async () => {
    const { authAPI } = require('../services/api');
    authAPI.login.mockResolvedValue({
      data: {
        success: true,
        user: { role: 'patient', email: 'patient@example.com' },
        token: 'mock-token'
      }
    });

    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'patient@example.com' }
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'Patient123!' }
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
    expect(authAPI.login).toHaveBeenCalledWith({
      email: 'patient@example.com',
      password: 'Patient123!'
    });
  });

  test('shows an error toast when credentials are invalid', async () => {
    const { authAPI } = require('../services/api');
    authAPI.login.mockRejectedValue({
      response: { data: { message: 'Invalid email or password' } }
    });

    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'wrong@example.com' }
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'WrongPassword!' }
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Invalid email or password');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('shows a validation error when email is empty', async () => {
    renderLogin();

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'Patient123!' }
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
    });
  });

  test('shows a validation error when password is empty', async () => {
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'patient@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });
});
