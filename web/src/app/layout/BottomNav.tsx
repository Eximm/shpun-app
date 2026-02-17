import React from "react";
import { NavLink } from "react-router-dom";

function Tab({
  to,
  label,
  icon,
  end,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => "tab" + (isActive ? " tab--active" : "")}
    >
      <span className="tab__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tab__label">{label}</span>
    </NavLink>
  );
}

export function BottomNav() {
  return (
    <nav className="bottomnav" role="navigation" aria-label="App navigation">
      <div className="bottomnav__inner">
        <Tab
          to="/"
          end
          label="Главная"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.2Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          }
        />

        <Tab
          to="/feed"
          label="Новости"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 7h12M6 12h12M6 17h9"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M4 6a2 2 0 0 1 2-2h11a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
                stroke="currentColor"
                strokeWidth="1.7"
                opacity="0.5"
              />
            </svg>
          }
        />

        <Tab
          to="/services"
          label="Услуги"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 7h10M7 12h10M7 17h10"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          }
        />

        <Tab
          to="/payments"
          label="Оплата"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M4 9h16"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          }
        />

        <Tab
          to="/profile"
          label="Профиль"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M4.5 20a7.5 7.5 0 0 1 15 0"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      </div>
    </nav>
  );
}
