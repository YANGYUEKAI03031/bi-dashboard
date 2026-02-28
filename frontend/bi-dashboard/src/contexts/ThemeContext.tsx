/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\contexts\ThemeContext.tsx */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface Theme {
  name: string;
  mode: 'light' | 'dark';
  colors: {
    // 背景色
    background: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    
    // 文本色
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    
    // 边框色
    border: string;
    borderLight: string;
    
    // 主色调
    primary: string;
    primaryHover: string;
    primaryActive: string;
    
    // 侧边栏
    sidebarBackground: string;
    sidebarBackgroundGradient: string;
    sidebarText: string;
    sidebarTextSecondary: string;
    sidebarBorder: string;
    sidebarActive: string;
    
    // 顶部栏
    topBarBackground: string;
    topBarBorder: string;
    topBarText: string;
    
    // 卡片
    cardBackground: string;
    cardBorder: string;
    cardShadow: string;
    
    // 按钮
    buttonBackground: string;
    buttonHover: string;
    buttonText: string;
    
    // 图表颜色（用于ECharts）
    chartColors: string[];
  };
}

// 主题定义
export const themes: Record<string, Theme> = {
  light: {
    name: '浅色',
    mode: 'light',
    colors: {
      background: '#f8fafc',
      backgroundSecondary: '#ffffff',
      backgroundTertiary: '#f1f5f9',
      textPrimary: '#1a202c',
      textSecondary: '#4a5568',
      textTertiary: '#718096',
      border: '#e2e8f0',
      borderLight: '#f1f5f9',
      primary: '#4299e1',
      primaryHover: '#3182ce',
      primaryActive: '#2c5282',
      sidebarBackground: '#2d3748',
      sidebarBackgroundGradient: 'linear-gradient(180deg, #2d3748 0%, #1a202c 100%)',
      sidebarText: '#ffffff',
      sidebarTextSecondary: '#a0aec0',
      sidebarBorder: 'rgba(255, 255, 255, 0.1)',
      sidebarActive: '#4299e1',
      topBarBackground: '#ffffff',
      topBarBorder: '#e2e8f0',
      topBarText: '#1a202c',
      cardBackground: '#ffffff',
      cardBorder: '#e2e8f0',
      cardShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      buttonBackground: '#f7fafc',
      buttonHover: '#edf2f7',
      buttonText: '#2d3748',
      chartColors: [
        '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
        '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#ff9f7f'
      ]
    }
  },
  dark: {
    name: '深色',
    mode: 'dark',
    colors: {
      background: '#1a202c',
      backgroundSecondary: '#2d3748',
      backgroundTertiary: '#4a5568',
      textPrimary: '#f7fafc',
      textSecondary: '#e2e8f0',
      textTertiary: '#cbd5e0',
      border: '#4a5568',
      borderLight: '#2d3748',
      primary: '#4299e1',
      primaryHover: '#63b3ed',
      primaryActive: '#3182ce',
      sidebarBackground: '#1a202c',
      sidebarBackgroundGradient: 'linear-gradient(180deg, #1a202c 0%, #0d1117 100%)',
      sidebarText: '#f7fafc',
      sidebarTextSecondary: '#a0aec0',
      sidebarBorder: 'rgba(255, 255, 255, 0.1)',
      sidebarActive: '#4299e1',
      topBarBackground: '#2d3748',
      topBarBorder: '#4a5568',
      topBarText: '#f7fafc',
      cardBackground: '#2d3748',
      cardBorder: '#4a5568',
      cardShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
      buttonBackground: '#4a5568',
      buttonHover: '#718096',
      buttonText: '#f7fafc',
      chartColors: [
        '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
        '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#ff9f7f'
      ]
    }
  },
  blue: {
    name: '蓝色',
    mode: 'light',
    colors: {
      background: '#ebf8ff',
      backgroundSecondary: '#ffffff',
      backgroundTertiary: '#bee3f8',
      textPrimary: '#1a365d',
      textSecondary: '#2c5282',
      textTertiary: '#3182ce',
      border: '#90cdf4',
      borderLight: '#bee3f8',
      primary: '#2b6cb0',
      primaryHover: '#2c5282',
      primaryActive: '#1a365d',
      sidebarBackground: '#1a365d',
      sidebarBackgroundGradient: 'linear-gradient(180deg, #2c5282 0%, #1a365d 100%)',
      sidebarText: '#ffffff',
      sidebarTextSecondary: '#90cdf4',
      sidebarBorder: 'rgba(255, 255, 255, 0.1)',
      sidebarActive: '#4299e1',
      topBarBackground: '#ffffff',
      topBarBorder: '#90cdf4',
      topBarText: '#1a365d',
      cardBackground: '#ffffff',
      cardBorder: '#90cdf4',
      cardShadow: '0 1px 3px rgba(27, 54, 93, 0.1)',
      buttonBackground: '#ebf8ff',
      buttonHover: '#bee3f8',
      buttonText: '#1a365d',
      chartColors: [
        '#2b6cb0', '#3182ce', '#4299e1', '#63b3ed', '#90cdf4',
        '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#ff9f7f'
      ]
    }
  },
  green: {
    name: '绿色',
    mode: 'light',
    colors: {
      background: '#f0fff4',
      backgroundSecondary: '#ffffff',
      backgroundTertiary: '#c6f6d5',
      textPrimary: '#1a202c',
      textSecondary: '#2f855a',
      textTertiary: '#48bb78',
      border: '#9ae6b4',
      borderLight: '#c6f6d5',
      primary: '#38a169',
      primaryHover: '#2f855a',
      primaryActive: '#276749',
      sidebarBackground: '#22543d',
      sidebarBackgroundGradient: 'linear-gradient(180deg, #2f855a 0%, #22543d 100%)',
      sidebarText: '#ffffff',
      sidebarTextSecondary: '#9ae6b4',
      sidebarBorder: 'rgba(255, 255, 255, 0.1)',
      sidebarActive: '#48bb78',
      topBarBackground: '#ffffff',
      topBarBorder: '#9ae6b4',
      topBarText: '#1a202c',
      cardBackground: '#ffffff',
      cardBorder: '#9ae6b4',
      cardShadow: '0 1px 3px rgba(34, 84, 61, 0.1)',
      buttonBackground: '#f0fff4',
      buttonHover: '#c6f6d5',
      buttonText: '#1a202c',
      chartColors: [
        '#38a169', '#48bb68', '#68d391', '#9ae6b4', '#c6f6d5',
        '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#ff9f7f'
      ]
    }
  }
};

const THEME_STORAGE_KEY = 'bi-dashboard.theme';

interface ThemeContextType {
  theme: Theme;
  themeName: string;
  themeMode: ThemeMode;
  setTheme: (themeName: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  availableThemes: string[];
  applyThemeToElement: (element: HTMLElement | null) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// 检测系统主题
const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

// 获取当前实际主题
const getCurrentTheme = (themeName: string, mode: ThemeMode): Theme => {
  if (mode === 'auto') {
    const systemTheme = getSystemTheme();
    return systemTheme === 'dark' ? themes.dark : themes[themeName] || themes.light;
  }
  return themes[themeName] || themes.light;
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeName, setThemeNameState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored && themes[stored]) {
        return stored;
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(`${THEME_STORAGE_KEY}.mode`);
      if (stored === 'light' || stored === 'dark' || stored === 'auto') {
        return stored;
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  const [theme, setThemeState] = useState<Theme>(() => 
    getCurrentTheme(themeName, themeMode)
  );

  // 在指定元素上应用主题CSS变量
  const applyThemeToElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    
    const currentTheme = getCurrentTheme(themeName, themeMode);
    
    Object.entries(currentTheme.colors).forEach(([key, value]) => {
      if (key === 'chartColors') {
        // 图表颜色单独处理
        (value as string[]).forEach((color, index) => {
          element.style.setProperty(`--chart-color-${index}`, color);
        });
      } else if (key === 'sidebarBackgroundGradient') {
        // 渐变单独处理
        if (typeof value === 'string') {
          element.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value);
        }
      } else {
        // 其他属性都是字符串类型
        if (typeof value === 'string') {
          const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          element.style.setProperty(`--theme-${cssKey}`, value);
        }
      }
    });
    
    // 设置data-theme属性
    element.setAttribute('data-theme', currentTheme.mode);
  }, [themeName, themeMode]);

  // 更新主题（不再全局应用，只更新状态）
  const updateTheme = useCallback((name: string, mode: ThemeMode) => {
    const newTheme = getCurrentTheme(name, mode);
    setThemeState(newTheme);
  }, []);

  // 设置主题名称
  const setTheme = useCallback((name: string) => {
    if (!themes[name]) return;
    setThemeNameState(name);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, name);
    } catch {
      // ignore
    }
    updateTheme(name, themeMode);
  }, [themeMode, updateTheme]);

  // 设置主题模式
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(`${THEME_STORAGE_KEY}.mode`, mode);
    } catch {
      // ignore
    }
    updateTheme(themeName, mode);
  }, [themeName, updateTheme]);

  // 监听系统主题变化
  useEffect(() => {
    if (themeMode !== 'auto') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      updateTheme(themeName, 'auto');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode, themeName, updateTheme]);

  // 初始化主题
  useEffect(() => {
    updateTheme(themeName, themeMode);
  }, []); // 只在初始化时执行

  const value = {
    theme,
    themeName,
    themeMode,
    setTheme,
    setThemeMode,
    availableThemes: Object.keys(themes),
    applyThemeToElement
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
