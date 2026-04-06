import React, { useState } from "react";

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Add authentication logic here
    console.log("Signing in:", email);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      {/* White card panel */}
      <div className="bg-white w-full max-w-xl min-h-screen flex flex-col items-center justify-center px-16 py-20">

        {/* Logo + Title */}
        <div className="flex items-center gap-6 mb-8">
          <img
            src="/logo192.png"
            alt="Coat of Arms"
            className="w-24 h-24 object-contain"
          />
          <h1 className="text-4xl font-black leading-tight tracking-wide uppercase">
            District
            <br />
            Intelligence
            <br />
            Dashboard
          </h1>
        </div>

        {/* Subtitle */}
        <p className="text-gray-500 text-sm mb-8">
          Sign in to manage Dashboard
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
          {/* Email */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-800">
              Enter your email
            </label>
            <input
              type="email"
              placeholder="Official@district.gov.mw"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border border-gray-300 rounded px-4 py-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black"
              required
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-800">
              Enter your Password
            </label>
            <input
              type="password"
              placeholder="••••••••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-gray-300 rounded px-4 py-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black"
              required
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="mt-2 bg-black text-white py-3 rounded font-semibold text-sm tracking-wide hover:bg-gray-800 transition-colors duration-200"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;