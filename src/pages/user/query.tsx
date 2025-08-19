import React, { useState, useEffect, useRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useRouter } from 'next/router';
import { useUserProtection } from '../../hooks/useAuth';
import { isAdmin } from '../../lib/auth';

// Available exchanges for filtering trade data
const EXCHANGE_OPTIONS = [
  'Nasdaq OMX BX, Inc.',
  'Nasdaq',
  'Nasdaq Philadelphia Exchange LLC',
  'FINRA Nasdaq TRF Carteret',
  'FINRA Nasdaq TRF Chicago'
];

// Display abbreviations for selected exchanges
const EXCHANGE_ABBREVIATIONS: { [key: string]: string } = {
  'Nasdaq OMX BX, Inc.': 'XBOS',
  'Nasdaq': 'XNAS',
  'Nasdaq Philadelphia Exchange LLC': 'XPHL',
  'FINRA Nasdaq TRF Carteret': 'FINN',
  'FINRA Nasdaq TRF Chicago': 'FINC'
};

// Sorting options for trade data export
const SORT_OPTIONS = {
  'timenew': 'Time (Newest)',
  'timeold': 'Time (Oldest)',
  'sizedesc': 'Size (High to Low)',
  'sizeasc': 'Size (Low to High)',
  'pricedesc': 'Price (High to Low)',
  'priceasc': 'Price (Low to High)'
};

//----modified----
// Aggregation options for derived columns
const AGGREGATE_OPTIONS = {
  'ns': 'Nanoseconds',
  'ms': 'Milliseconds',
  's': 'Seconds',
  'min': 'Minutes',
  'hr': 'Hours',
  'day': 'Days'
};
//----modified----

export default function QueryPage() {
  const router = useRouter();
  useUserProtection();
  let cf_url = '';
  try {
    // @ts-ignore
    cf_url = require('../../../public/cf_url.json').cf_url;
  } catch {}
  // Exchange filtering state
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>([]);
  const [exchangeInput, setExchangeInput] = useState('');
  const [showExchangeDropdown, setShowExchangeDropdown] = useState(false);
  const [exchangeCursorIndex, setExchangeCursorIndex] = useState(-1);
  const [exchangeDropdownIndex, setExchangeDropdownIndex] = useState(-1);
  
  // Filter range state
  const [priceRange, setPriceRange] = useState([null, null]);
  const [volumeRange, setVolumeRange] = useState([null, null]);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  
  // Equation builder state
  const [selectedEquations, setSelectedEquations] = useState<string[]>([]);
  const [equationInput, setEquationInput] = useState('');
  const [equationCursorPosition, setEquationCursorPosition] = useState(0);
  const [equationError, setEquationError] = useState('');
  const [equationCursorIndex, setEquationCursorIndex] = useState(-1);
  const [isEquationInputFocused, setIsEquationInputFocused] = useState(false);
  
  // UI state
  const [sortBy, setSortBy] = useState('timenew');
  //----modified----
  const [aggregateBy, setAggregateBy] = useState('ms');
  //----modified----
  const [isDownloading, setIsDownloading] = useState(false);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [userIsAdmin, setUserIsAdmin] = useState(false);
  
  // Component refs for focus management
  const exchangeInputRef = useRef<HTMLInputElement>(null);
  const equationInputRef = useRef<HTMLInputElement>(null);
  // Container refs for pill shifting
  const exchangePillsContainerRef = useRef<HTMLDivElement>(null);
  const equationPillsContainerRef = useRef<HTMLDivElement>(null);

  // Dynamic shifting helper - ensures input is always visible and container scrolls adaptively
  const ensureInputVisibility = (
    inputRef: React.RefObject<HTMLInputElement>,
    containerRef?: React.RefObject<HTMLDivElement>,
    forceScrollToEnd?: boolean
  ) => {
    if (containerRef && containerRef.current && inputRef.current) {
      const container = containerRef.current;
      const input = inputRef.current;
      
      // If forceScrollToEnd is true (like after pressing Enter), scroll all the way to the end
      if (forceScrollToEnd) {
        container.scrollLeft = container.scrollWidth;
        return;
      }
      
      // Otherwise, use adaptive scrolling during typing
      // Create a temporary element to measure the actual text width
      const temp = document.createElement('span');
      temp.style.visibility = 'hidden';
      temp.style.position = 'absolute';
      temp.style.whiteSpace = 'pre';
      temp.style.font = window.getComputedStyle(input).font;
      temp.textContent = input.value;
      document.body.appendChild(temp);
      
      const textWidth = temp.offsetWidth;
      document.body.removeChild(temp);
      
      // Get the input's position relative to the container
      const inputRect = input.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const inputLeftInContainer = inputRect.left - containerRect.left;
      
      // Calculate how much space we need for the text
      const neededWidth = textWidth + 20; // Add some padding
      const availableWidth = container.clientWidth - inputLeftInContainer;
      
      // If the text needs more space than available, shift pills left
      if (neededWidth > availableWidth) {
        const scrollAmount = neededWidth - availableWidth;
        container.scrollLeft += scrollAmount;
      }
    }
  };

  useEffect(() => {
    setUserIsAdmin(isAdmin());
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/user/login');
  };

  // Returns available exchanges filtered by search input
  const getFilteredExchanges = () => {
    if (!exchangeInput.trim()) return EXCHANGE_OPTIONS.filter(exchange => !selectedExchanges.includes(exchange));
    return EXCHANGE_OPTIONS.filter(exchange => 
      exchange.toLowerCase().includes(exchangeInput.toLowerCase()) &&
      !selectedExchanges.includes(exchange)
    ).slice(0, 10);
  };

  // Validates if a character can be typed at current cursor position in equation input
  const isValidEquationChar = (char: string, currentInput: string, cursorPos: number) => {
    const beforeCursor = currentInput.slice(0, cursorPos);
    const afterCursor = currentInput.slice(cursorPos);
    const lastNonSpaceChar = beforeCursor.replace(/\s+$/, '').slice(-1);
    const trimmedBefore = beforeCursor.trim();
    
    // Block typing inside existing PRICE/SIZE words
    const wordAtCursor = (beforeCursor + afterCursor).match(/(?:^|[\s\+\-\*\/\^\(])([PS](?:[RI](?:[IC](?:[CE]?)?)?)?|S(?:I(?:Z(?:E?)?)?)?)(?=[\s\+\-\*\/\^\)]|$)/);
    if (wordAtCursor) {
      const wordStart = beforeCursor.lastIndexOf(wordAtCursor[1]);
      const wordEnd = wordStart + wordAtCursor[1].length;
      
      if (cursorPos >= wordStart && cursorPos < wordEnd) {
        return false;
      }
    }
    
    // Check for incomplete PRICE/SIZE words
    const incompleteWordPattern = /(?:^|[\s\+\-\*\/\^\(])([PS](?:[RI](?:[IC](?:[CE]?)?)?)?|S(?:I(?:Z(?:E?)?)?)?)$/;
    const incompleteMatch = trimmedBefore.match(incompleteWordPattern);
    const isInIncompleteWord = incompleteMatch && 
      !incompleteMatch[1].endsWith('PRICE') && 
      !incompleteMatch[1].endsWith('SIZE');
    
    // Space handling - prevent breaking words and invalid placements
    if (char === ' ') {
      if (cursorPos === 0) return false;
      if (/[P][R]?[I]?[C]?$/.test(trimmedBefore) && !trimmedBefore.endsWith('PRICE')) return false;
      if (/[S][I]?[Z]?$/.test(trimmedBefore) && !trimmedBefore.endsWith('SIZE')) return false;
      if (/\d\.$/.test(beforeCursor.replace(/\s/g, ''))) return false;
      if (/\d$/.test(beforeCursor.replace(/\s/g, '')) && /^\d/.test(afterCursor.replace(/\s/g, ''))) return false;
      return true;
    }
    
    // Digit input validation
    if (/\d/.test(char)) {
      if (isInIncompleteWord) return false;
      if (lastNonSpaceChar === ')') return false;
      
      if (cursorPos === 0) return true;
      if (lastNonSpaceChar === '(') return true;
      if (/[\+\-\*\/\^]/.test(lastNonSpaceChar)) return true;
      if (/\d/.test(lastNonSpaceChar)) return true;
      if (lastNonSpaceChar === '.') return true;
      return false;
    }
    
    // Decimal point validation
    if (char === '.') {
      if (isInIncompleteWord) return false;
      if (!/\d/.test(lastNonSpaceChar)) return false;
      
      const currentNumber = beforeCursor.replace(/\s/g, '').match(/\d*\.?\d*$/)?.[0] || '';
      if (currentNumber.includes('.')) return false;
      
      return true;
    }
    
    // PRICE word sequence validation
    if (char.toLowerCase() === 'p') {
      if (lastNonSpaceChar === ')') return false;
      
      if (cursorPos === 0) return true;
      if (lastNonSpaceChar === '(') return true;
      if (/[\+\-\*\/\^]/.test(lastNonSpaceChar)) return true;
      return false;
    }
    
    if (char.toLowerCase() === 'r') {
      return trimmedBefore.endsWith('P');
    }
    
    if (char.toLowerCase() === 'i') {
      return trimmedBefore.endsWith('PR') || trimmedBefore.endsWith('S');
    }
    
    if (char.toLowerCase() === 'c') {
      return trimmedBefore.endsWith('PRI');
    }
    
    if (char.toLowerCase() === 'e') {
      return trimmedBefore.endsWith('PRIC') || trimmedBefore.endsWith('SIZ');
    }
    
    // SIZE word sequence validation
    if (char.toLowerCase() === 's') {
      if (lastNonSpaceChar === ')') return false;
      
      if (cursorPos === 0) return true;
      if (lastNonSpaceChar === '(') return true;
      if (/[\+\-\*\/\^]/.test(lastNonSpaceChar)) return true;
      return false;
    }
    
    if (char.toLowerCase() === 'z') {
      return trimmedBefore.endsWith('SI');
    }
    
    // Standard operators (+, *, /, ^)
    if (/[\+\*\/\^]/.test(char)) {
      if (isInIncompleteWord) return false;
      
      if (/PRICE$/.test(trimmedBefore)) return true;
      if (/SIZE$/.test(trimmedBefore)) return true;
      if (/\d$/.test(trimmedBefore)) return true;
      if (lastNonSpaceChar === ')') return true;
      return false;
    }
    
    // Minus sign (unary or binary operator)
    if (char === '-') {
      if (isInIncompleteWord) return false;
      
      // Unary minus positions
      if (cursorPos === 0) return true;
      if (lastNonSpaceChar === '(') return true;
      if (/[\+\-\*\/\^]/.test(lastNonSpaceChar)) return true;
      
      // Binary minus positions
      if (/PRICE$/.test(trimmedBefore)) return true;
      if (/SIZE$/.test(trimmedBefore)) return true;
      if (/\d$/.test(trimmedBefore)) return true;
      if (lastNonSpaceChar === ')') return true;
      
      return false;
    }
    
    // Opening parenthesis
    if (char === '(') {
      if (isInIncompleteWord) return false;
      if (lastNonSpaceChar === ')') return false;
      
      if (cursorPos === 0) return true;
      if (/[\+\-\*\/\^]/.test(lastNonSpaceChar)) return true;
      return false;
    }
    
    // Block direct typing of closing parenthesis
    if (char === ')') {
      return false;
    }
    
    return false;
  };

  // Handles backspace behavior in equation input with smart deletion logic
  const handleEquationBackspace = (currentInput: string, cursorPos: number) => {
    if (cursorPos === 0) return { newInput: currentInput, newCursorPos: 0 };
    
    const beforeCursorBackspace = currentInput.slice(0, cursorPos);
    const afterCursorBackspace = currentInput.slice(cursorPos);
    const trimmedBeforeBackspace = beforeCursorBackspace.trim();
    
    // Prevent deleting operators that have content after them
    const charToDelete = currentInput[cursorPos - 1];
    if (/[\+\*\/\^]/.test(charToDelete)) {
      const afterOperator = currentInput.slice(cursorPos).trim();
      const hasContentAfter = afterOperator && !afterOperator.startsWith(')');
      
      if (hasContentAfter) {
        return { newInput: currentInput, newCursorPos: cursorPos };
      }
    }
    
    // Handle binary minus deletion
    if (charToDelete === '-') {
      const afterOperator = currentInput.slice(cursorPos).trim();
      const hasContentAfter = afterOperator && !afterOperator.startsWith(')');
      
      if (hasContentAfter) {
        return { newInput: currentInput, newCursorPos: cursorPos };
      }
    }
    
    // Handle backspacing partial or complete PRICE/SIZE words (high priority)
    if (/P(?:R(?:I(?:C(?:E)?)?)?)?$|S(?:I(?:Z(?:E)?)?)?$/.test(trimmedBeforeBackspace)) {
      const priceMatch = trimmedBeforeBackspace.match(/(.*?)(P(?:R(?:I(?:C(?:E)?)?)?)?)$/);
      const sizeMatch = trimmedBeforeBackspace.match(/(.*?)(S(?:I(?:Z(?:E)?)?)?)$/);
      const match = priceMatch || sizeMatch;
      
      if (match) {
        const beforeWord = match[1];
        const wordLength = match[2].length;
        const spacesAfter = beforeCursorBackspace.length - trimmedBeforeBackspace.length;
        return {
          newInput: beforeWord + ' '.repeat(spacesAfter) + afterCursorBackspace,
          newCursorPos: beforeWord.length + spacesAfter
        };
      }
    }

    // Handle backspace with parentheses (cursor after ) or inside empty parentheses)
    if (cursorPos >= 1 && currentInput[cursorPos - 1] === ')') {
      // Find the matching opening parenthesis
      let parenCount = 1;
      let openPos = cursorPos - 2;
      
      while (openPos >= 0 && parenCount > 0) {
        if (currentInput[openPos] === ')') parenCount++;
        if (currentInput[openPos] === '(') parenCount--;
        if (parenCount > 0) openPos--;
      }
      
      // If we found the matching opening parenthesis
      if (parenCount === 0 && openPos >= 0) {
        // Check if this is a unary minus pattern -(...)
        let removeStart = openPos;
        if (openPos > 0 && currentInput[openPos - 1] === '-') {
          // Check if the minus is unary (no operator before it)
          const beforeMinus = currentInput.slice(0, openPos - 1).trim();
          const lastChar = beforeMinus.slice(-1);
          
          if (lastChar === '' || lastChar === '(' || /[\+\-\*\/\^]/.test(lastChar)) {
            // This is a unary minus, remove it too
            removeStart = openPos - 1;
          }
        }
        
        // Remove the entire expression
        return { 
          newInput: currentInput.slice(0, removeStart) + currentInput.slice(cursorPos),
          newCursorPos: removeStart
        };
      }
    }
    
    // Handle backspace inside empty parentheses (|)
    if (cursorPos >= 1 && cursorPos < currentInput.length &&
        currentInput[cursorPos - 1] === '(' && currentInput[cursorPos] === ')') {
      
      // Check if this is part of a unary minus pattern -(|)
      let removeStart = cursorPos - 1;
      if (cursorPos >= 2 && currentInput[cursorPos - 2] === '-') {
        // Check if the minus is unary (no operator before it)
        const beforeMinus = currentInput.slice(0, cursorPos - 2).trim();
        const lastChar = beforeMinus.slice(-1);
        
        if (lastChar === '' || lastChar === '(' || /[\+\-\*\/\^]/.test(lastChar)) {
          // This is a unary minus, remove it too
          removeStart = cursorPos - 2;
        }
      }
      
      // Remove the empty parentheses (and unary minus if applicable)
      return {
        newInput: currentInput.slice(0, removeStart) + currentInput.slice(cursorPos + 1),
        newCursorPos: removeStart
      };
    }
    
    // Handle backspacing in middle of unary minus pattern like: + -(  ) where cursor is between - and (
    if (cursorPos >= 2 && 
        currentInput[cursorPos - 1] === '-' && 
        currentInput[cursorPos] === '(') {
      // Look backwards to see if this is a unary minus pattern
      const beforeMinus = currentInput.slice(0, cursorPos - 1).trim();
      const lastChar = beforeMinus.slice(-1);
      
      if (lastChar === '' || lastChar === '(' || /[\+\-\*\/\^]/.test(lastChar)) {
        // This is a unary minus, remove the whole -(  ) pattern
        let endPos = cursorPos + 1; // Start after the (
        // Find the matching )
        let parenCount = 1;
        while (endPos < currentInput.length && parenCount > 0) {
          if (currentInput[endPos] === '(') parenCount++;
          if (currentInput[endPos] === ')') parenCount--;
          endPos++;
        }
        
        return {
          newInput: currentInput.slice(0, cursorPos - 1) + currentInput.slice(endPos),
          newCursorPos: cursorPos - 1
        };
      } else {
        // This is a binary minus followed by (, just remove the -
        return {
          newInput: currentInput.slice(0, cursorPos - 1) + currentInput.slice(cursorPos),
          newCursorPos: cursorPos - 1
        };
      }
    }

    // Handle backspacing unary minus -(  ) patterns
    const unaryMinusPattern = /[\+\-\*\/\^]\s*-\(\s*$/;
    const startUnaryMinusPattern = /^-\(\s*$/;
    
    if (unaryMinusPattern.test(beforeCursorBackspace)) {
      // Remove back to the operator
      const match = beforeCursorBackspace.match(/([\+\-\*\/\^])\s*-\(\s*$/);
      if (match) {
        const operatorPos = beforeCursorBackspace.lastIndexOf(match[1]);
        return {
          newInput: currentInput.slice(0, operatorPos + 1) + ' ' + afterCursorBackspace,
          newCursorPos: operatorPos + 2
        };
      }
    } else if (startUnaryMinusPattern.test(beforeCursorBackspace)) {
      // Remove the entire -(  ) at start
      return {
        newInput: afterCursorBackspace,
        newCursorPos: 0
      };
    }
    
    // Default single character deletion
    return { 
      newInput: currentInput.slice(0, cursorPos - 1) + afterCursorBackspace,
      newCursorPos: cursorPos - 1
    };
  };

  // Formats equation string for clean display with proper spacing
  const formatEquationForDisplay = (equation: string) => {
    let formatted = equation.replace(/\s+/g, '');
    
    // Clean up empty patterns
    formatted = formatted.replace(/\(\)/g, '');
    formatted = formatted.replace(/-\(\)/g, '');
    
    // Remove leading zeros
    formatted = formatted.replace(/\b0+(\d+)/g, '$1');
    formatted = formatted.replace(/\b0+(\d*\.\d+)/g, '$1');
    
    // Add consistent spacing around operators
    formatted = formatted.replace(/([\+\-\*\/\^])/g, ' $1 ');
    formatted = formatted.replace(/\s+/g, ' ');
    
    // Clean up parentheses spacing
    formatted = formatted.replace(/\(\s+/g, '(');
    formatted = formatted.replace(/\s+\)/g, ')');
    
    return formatted.trim();
  };

  // Validates equation syntax and completeness
  const validateEquation = (equation: string) => {
    let cleanEquation = equation.replace(/\s+/g, '');
    console.log('Cleaning equation:', JSON.stringify(equation), '→', JSON.stringify(cleanEquation));
    
    // Clean up empty patterns
    cleanEquation = cleanEquation.replace(/\(\)/g, '');
    cleanEquation = cleanEquation.replace(/-\(\)/g, '');
    console.log('After cleanup:', JSON.stringify(cleanEquation));
    
    // Check for incomplete PRICE/SIZE words
    if (/P(?!RICE)|PR(?!ICE)|PRI(?!CE)|PRIC(?!E)/.test(cleanEquation)) {
      return 'Incomplete word detected. Please complete PRICE or SIZE.';
    }
    if (/S(?!IZE)|SI(?!ZE)|SIZ(?!E)/.test(cleanEquation)) {
      return 'Incomplete word detected. Please complete PRICE or SIZE.';
    }
    
    // Validate parentheses balance
    let parenCount = 0;
    for (const char of cleanEquation) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) return 'Unmatched closing parenthesis.';
    }
    if (parenCount > 0) return 'Unmatched opening parenthesis.';
    
    // Check for valid operands
    const operands = cleanEquation.split(/[\+\-\*\/\^\(\)]/).filter(part => 
      part && (part === 'PRICE' || part === 'SIZE' || /^\d+\.?\d*$/.test(part))
    );
    
    if (operands.length <= 1) {
      return 'Equation must contain multiple operands connected by operators.';
    }
    
    // Ensure at least one operator exists
    const operators = cleanEquation.match(/[\+\-\*\/\^]/g) || [];
    if (operators.length === 0) {
      return 'Equation must contain at least one operator.';
    }
    
    // Check for consecutive operators
    if (/[\+\*\/\^][\+\-\*\/\^]/.test(cleanEquation)) {
      return 'Consecutive operators are not allowed.';
    }
    
    // Equation cannot end with operator
    if (/[\+\-\*\/\^]$/.test(cleanEquation)) {
      return 'Equation cannot end with an operator.';
    }
    
    // Check for operator before closing parenthesis
    if (/[\+\-\*\/\^]\)/.test(cleanEquation)) {
      return 'Equation cannot end with an operator.';
    }
    
    return null;
  };

  // Checks if equation is valid and complete
  const isEquationComplete = (equation: string) => {
    return equation.trim().length > 0 && validateEquation(equation) === null;
  };



  // Exchange selection and management functions
  const handleExchangeSelect = (exchange: string) => {
    if (!selectedExchanges.includes(exchange)) {
      setSelectedExchanges(prev => [...prev, exchange]);
    }
    setExchangeInput('');
    setExchangeCursorIndex(-1);
    setExchangeDropdownIndex(-1);
    setTimeout(() => {
      if (exchangeInputRef.current) {
        exchangeInputRef.current.focus();
        setShowExchangeDropdown(true);
        exchangeInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
      }
    }, 100);
  };

  const handleExchangeRemove = (exchange: string) => {
    setSelectedExchanges(prev => prev.filter(e => e !== exchange));
    setExchangeCursorIndex(-1);
    setTimeout(() => {
      if (exchangeInputRef.current) {
        exchangeInputRef.current.focus();
        setShowExchangeDropdown(true);
      }
    }, 0);
  };

  // Keyboard navigation for exchange dropdown
  const handleExchangeKeyDown = (e: React.KeyboardEvent) => {
    const filteredExchanges = getFilteredExchanges();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredExchanges.length > 0) {
        setShowExchangeDropdown(true);
        const newIndex = exchangeDropdownIndex < filteredExchanges.length - 1 ? exchangeDropdownIndex + 1 : 0;
        setExchangeDropdownIndex(newIndex);
        setTimeout(() => {
          const dropdown = document.querySelector('.exchange-dropdown');
          const selectedItem = dropdown?.children[newIndex] as HTMLElement;
          if (selectedItem && dropdown) {
            selectedItem.scrollIntoView({ block: 'nearest' });
          }
        }, 0);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredExchanges.length > 0) {
        setShowExchangeDropdown(true);
        const newIndex = exchangeDropdownIndex > 0 ? exchangeDropdownIndex - 1 : filteredExchanges.length - 1;
        setExchangeDropdownIndex(newIndex);
        setTimeout(() => {
          const dropdown = document.querySelector('.exchange-dropdown');
          const selectedItem = dropdown?.children[newIndex] as HTMLElement;
          if (selectedItem && dropdown) {
            selectedItem.scrollIntoView({ block: 'nearest' });
          }
        }, 0);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredExchanges.length > 0) {
        const selectedExchange = exchangeDropdownIndex >= 0 
          ? filteredExchanges[exchangeDropdownIndex] 
          : filteredExchanges[0];
        handleExchangeSelect(selectedExchange);
      }
    } else if (e.key === 'Escape') {
      setShowExchangeDropdown(false);
      setExchangeDropdownIndex(-1);
    } else if (e.key === 'Backspace' && exchangeInput === '') {
      if (exchangeCursorIndex >= 0 && exchangeCursorIndex < selectedExchanges.length) {
        setSelectedExchanges(prev => prev.filter((_, index) => index !== exchangeCursorIndex));
        setExchangeCursorIndex(-1);
      } else if (selectedExchanges.length > 0) {
        setSelectedExchanges(prev => prev.slice(0, -1));
      }
    } else if (e.key === 'ArrowLeft' && exchangeInput === '') {
      setExchangeCursorIndex(prev => Math.max(0, prev === -1 ? selectedExchanges.length - 1 : prev - 1));
    } else if (e.key === 'ArrowRight' && exchangeInput === '') {
      setExchangeCursorIndex(prev => prev >= selectedExchanges.length - 1 ? -1 : prev + 1);
    } else {
      setExchangeDropdownIndex(-1);
    }
  };

  const handleEquationRemove = (equation: string) => {
    setSelectedEquations(prev => prev.filter(e => e !== equation));
    setEquationCursorIndex(-1);
    setEquationError('');
    setTimeout(() => {
      if (equationInputRef.current) {
        equationInputRef.current.focus();
        ensureInputVisibility(equationInputRef, equationPillsContainerRef);
      }
    }, 0);
  };

  // Main keyboard handler for equation input with validation and smart typing
  const handleEquationKeyDown = (e: React.KeyboardEvent) => {
    if (!equationInputRef.current) return;
    
    const cursorPos = equationInputRef.current.selectionStart || 0;
    setEquationCursorPosition(cursorPos);
    
    if (e.key === 'Enter') {
      e.preventDefault();
      if (equationInput.trim() && selectedEquations.length < 5) {
        console.log('Validating equation:', JSON.stringify(equationInput));
        const validationError = validateEquation(equationInput);
        console.log('Validation result:', validationError);
        if (validationError) {
          setEquationError(validationError);
        } else {
          const formattedEquation = formatEquationForDisplay(equationInput);
          setSelectedEquations(prev => [...prev, formattedEquation]);
          setEquationInput('');
          setEquationCursorIndex(-1);
          setEquationCursorPosition(0);
          setEquationError('');
          setTimeout(() => {
            if (equationInputRef.current) {
              equationInputRef.current.focus();
              // Only scroll to end and create fixed visible space for first 4 pills
              const shouldScrollToEnd = selectedEquations.length < 4;
              ensureInputVisibility(equationInputRef, equationPillsContainerRef, shouldScrollToEnd);
            }
          }, 0);
        }
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (equationInput === '') {
        // Handle equation pill removal
        if (equationCursorIndex >= 0 && equationCursorIndex < selectedEquations.length) {
          setSelectedEquations(prev => prev.filter((_, index) => index !== equationCursorIndex));
          setEquationCursorIndex(-1);
        } else if (selectedEquations.length > 0) {
          setSelectedEquations(prev => prev.slice(0, -1));
        }
      } else {
        // Smart backspace in equation input
        const result = handleEquationBackspace(equationInput, cursorPos);
        setEquationInput(result.newInput);
        setEquationCursorPosition(result.newCursorPos);
        setTimeout(() => {
          if (equationInputRef.current) {
            equationInputRef.current.setSelectionRange(result.newCursorPos, result.newCursorPos);
            ensureInputVisibility(equationInputRef, equationPillsContainerRef);
          }
        }, 0);
      }
    } else if (e.key === 'ArrowLeft' && equationInput === '') {
      // Only handle pill navigation when input is empty
      setEquationCursorIndex(prev => Math.max(0, prev === -1 ? selectedEquations.length - 1 : prev - 1));
    } else if (e.key === 'ArrowRight' && equationInput === '') {
      // Only handle pill navigation when input is empty
      setEquationCursorIndex(prev => prev >= selectedEquations.length - 1 ? -1 : prev + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Allow normal cursor navigation within the text - don't prevent default
      return;
    } else if (e.key.length === 1) {
      // Character input with validation and auto-formatting
      e.preventDefault();
      const char = e.key.toUpperCase();
      
      if (isValidEquationChar(char, equationInput, cursorPos)) {
        const beforeCursor = equationInput.slice(0, cursorPos);
        const afterCursor = equationInput.slice(cursorPos);
        let newInput = beforeCursor + char + afterCursor;
        let newCursorPos = cursorPos + 1;
        
        // Auto-complete parentheses
        if (char === '(') {
          newInput = beforeCursor + '()' + afterCursor;
          newCursorPos = cursorPos + 1;
        } else if (char === '-') {
          // Auto-create unary minus pattern
          const trimmedBefore = beforeCursor.trim();
          const lastChar = trimmedBefore.slice(-1);
          
          const nextChar = afterCursor.trim().charAt(0);
          
          if ((cursorPos === 0 || lastChar === '(' || /[\+\-\*\/\^]/.test(lastChar)) && nextChar !== '(') {
            // Create unary minus -(  ) only if there's no ( after cursor
            newInput = beforeCursor + '-()' + afterCursor;
            newCursorPos = cursorPos + 2; // Position between ( and )
          }
          // If there's already a ( after cursor, just add the - sign (default behavior)
        }
        
        setEquationInput(newInput);
        setEquationCursorPosition(newCursorPos);
        setTimeout(() => {
          if (equationInputRef.current) {
            equationInputRef.current.setSelectionRange(newCursorPos, newCursorPos);
            ensureInputVisibility(equationInputRef, equationPillsContainerRef);
          }
        }, 0);
      }
    }
  };

  // Prevents direct input changes - all input handled by keyDown
  const handleEquationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
  };

  // Reset all filters and form state
  const handleResetFilters = () => {
    setSelectedExchanges([]);
    setExchangeInput('');
    setSelectedEquations([]);
    setEquationInput('');
    setEquationError('');
    setPriceRange([null, null]);
    setVolumeRange([null, null]);
    setDateRange([null, null]);
    setSortBy('timenew');
    //----modified----
    setAggregateBy('ms');
    //----modified----
    setEquationCursorIndex(-1);
    setExchangeCursorIndex(-1);
    setExchangeDropdownIndex(-1);
  };

  // CSV export functions
  const handleDownloadCSV = () => {
    setShowExportPopup(true);
  };

  const handleExportWithReset = async () => {
    setShowExportPopup(false);
    setIsDownloading(true);
    await performDownload();
    handleResetFilters();
  };

  const handleExportWithoutReset = async () => {
    setShowExportPopup(false);
    setIsDownloading(true);
    await performDownload();
  };

  // Main function to handle CSV generation and download
  const performDownload = async () => {
    try {
      // Prepare request with current filter settings
      const requestBody = {
        exchanges: selectedExchanges.length > 0 ? selectedExchanges : undefined,
        pricelow: priceRange[0] ?? 0,
        pricehigh: priceRange[1] ?? 1000,
        sizelow: volumeRange[0] ?? 0,
        sizehigh: volumeRange[1] ?? 1000000,
        datelow: dateRange[0] ? dateRange[0].toISOString().split('T')[0] : '2015-07-01',
        datehigh: dateRange[1] ? dateRange[1].toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        operations: selectedEquations.map(eq => ({
          expression: eq
        })),
        //----modified----
        sortby: selectedEquations.length === 0 ? sortBy : undefined,
        aggregateby: selectedEquations.length > 0 ? aggregateBy : undefined
        //----modified----
      };
      
      // Request CSV generation
      const response = await fetch(`${cf_url}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error generating CSV file');
      }
      
      const result = await response.json();
      if (result.status !== 'success' || !result.filename) {
        throw new Error('Failed to generate CSV file');
      }
      
      // Download the generated file
      const downloadResponse = await fetch(`${cf_url}/download/${result.filename}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!downloadResponse.ok) {
        throw new Error('Error downloading the generated file');
      }
      
      // Trigger file download
      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trades.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 font-sans flex flex-col">
      {/* Navigation Bar */}
      <nav className="fixed top-0 left-0 w-full bg-white/90 backdrop-blur border-b border-gray-200 shadow z-10 flex items-center justify-between px-8 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-extrabold tracking-tight text-blue-800">Historical Data</span>
        </div>
        <div className="flex gap-2">
          {userIsAdmin && (
            <button 
              onClick={() => window.open('/admin/create-user', '_blank')}
              className="border border-green-600 text-green-600 bg-white px-4 py-1.5 rounded-md font-medium hover:bg-green-600 hover:text-white focus:ring-2 focus:ring-green-200 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              disabled={isDownloading}
            >
              Admin
            </button>
          )}
          <button 
            onClick={handleLogout}
            className="border border-red-600 text-red-600 bg-white px-4 py-1.5 rounded-md font-medium hover:bg-red-600 hover:text-white focus:ring-2 focus:ring-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            disabled={isDownloading}
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="w-full max-w-5xl mx-auto pt-28 pb-8 px-4 flex-1">
        {/* Filters Card */}
        <div className="bg-white border border-gray-200 rounded-xl shadow p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Exchange Multi-input */}
            <div className="relative">
              <label className="block text-xs font-semibold mb-3 text-gray-600">
                Exchanges{selectedExchanges.length > 0 && ` (${selectedExchanges.length} selected)`}
              </label>
              <div className="border border-gray-300 rounded p-2 px-3 h-[40px] flex gap-1 items-center focus-within:ring-2 focus-within:ring-blue-200 overflow-hidden">
                <div
                  className="flex gap-1 items-center overflow-x-auto overflow-y-hidden scrollbar-hide flex-1"
                  ref={exchangePillsContainerRef}
                >
                  {selectedExchanges.map((exchange, index) => (
                    <span 
                      key={exchange} 
                      className={`bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center h-[30px] gap-1 flex-shrink-0 ${
                        exchangeCursorIndex === index ? 'ring-2 ring-blue-400' : ''
                      }`}
                    >
                      {EXCHANGE_ABBREVIATIONS[exchange] || exchange}
                      <button 
                        onClick={() => handleExchangeRemove(exchange)}
                        className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer !p-0"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {selectedExchanges.length < EXCHANGE_OPTIONS.length && (
                    <input
                      ref={exchangeInputRef}
                      type="text"
                      className="flex-1 outline-none text-sm font-mono"
                      style={{ minWidth: '60px' }}
                      placeholder={selectedExchanges.length === 0 ? "All Exchanges" : ""}
                      value={exchangeInput}
                      onChange={e => {
                        setExchangeInput(e.target.value);
                        setShowExchangeDropdown(true);
                        setExchangeCursorIndex(-1);
                        setExchangeDropdownIndex(-1);
                        // Trigger dynamic shifting as user types
                        setTimeout(() => ensureInputVisibility(exchangeInputRef, exchangePillsContainerRef), 0);
                      }}
                      onFocus={() => {
                        setShowExchangeDropdown(true);
                        setExchangeCursorIndex(-1);
                        setExchangeDropdownIndex(-1);
                        setTimeout(() => ensureInputVisibility(exchangeInputRef, exchangePillsContainerRef), 0);
                      }}
                      onBlur={() => setTimeout(() => setShowExchangeDropdown(false), 300)}
                      onKeyDown={handleExchangeKeyDown}
                    />
                  )}
                </div>
              </div>
              {showExchangeDropdown && getFilteredExchanges().length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-32 overflow-y-auto scrollbar-hide exchange-dropdown">
                  {getFilteredExchanges().map((exchange, index) => (
                    <div
                      key={exchange}
                      className={`p-2 cursor-pointer text-sm ${
                        index === exchangeDropdownIndex ? 'bg-blue-100' : 'hover:bg-blue-50'
                      }`}
                      onMouseDown={() => handleExchangeSelect(exchange)}
                      onMouseEnter={() => setExchangeDropdownIndex(index)}
                    >
                      {exchange}
                    </div>
                  ))}
                </div>
              )}
            </div>



            {/* Equation Builder */}
            <div className="relative">
              <label className="block text-xs font-semibold mb-3 text-gray-600">
                Custom Calculations{selectedEquations.length > 0 && ` (${selectedEquations.length}/5 equations)`}
              </label>
              <div className="border border-gray-300 rounded p-2 px-3 h-[40px] flex gap-1 items-center focus-within:ring-2 focus-within:ring-blue-200 overflow-hidden">
                <div
                  className="flex gap-1 items-center overflow-x-auto overflow-y-hidden scrollbar-hide flex-1"
                  ref={equationPillsContainerRef}
                >
                  {selectedEquations.map((equation, index) => (
                    <span 
                      key={equation} 
                      className={`bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center h-[30px] gap-1 flex-shrink-0 ${
                        equationCursorIndex === index ? 'ring-2 ring-blue-400' : ''
                      }`}
                    >
                      {equation}
                      <button 
                        onClick={() => handleEquationRemove(equation)}
                        className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer !p-0"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {selectedEquations.length < 5 && (
                    <input
                      ref={equationInputRef}
                      type="text"
                      className="flex-1 outline-none text-sm font-mono"
                      style={{ minWidth: '60px' }}
                      placeholder={selectedEquations.length === 0 ? "Enter Equations" : ""}
                      value={equationInput}
                      onChange={handleEquationChange}
                      onFocus={() => {
                        setEquationCursorIndex(-1);
                        setIsEquationInputFocused(true);
                        ensureInputVisibility(equationInputRef, equationPillsContainerRef);
                      }}
                      onBlur={() => {
                        setIsEquationInputFocused(false);
                      }}
                      onInput={() => {
                        // Trigger dynamic shifting on every input change
                        setTimeout(() => ensureInputVisibility(equationInputRef, equationPillsContainerRef), 0);
                      }}
                      onKeyDown={handleEquationKeyDown}
                      onSelect={(e) => {
                        // Update cursor position state but prevent text selection
                        const target = e.target as HTMLInputElement;
                        const newCursorPos = target.selectionStart || 0;
                        
                        // Only prevent selection if there's actually selected text
                        if (target.selectionStart !== target.selectionEnd) {
                          e.preventDefault();
                          target.setSelectionRange(newCursorPos, newCursorPos);
                        }
                        
                        // Update our cursor position state
                        setEquationCursorPosition(newCursorPos);
                      }}
                      onCopy={(e) => {
                        // Prevent copy
                        e.preventDefault();
                      }}
                      onPaste={(e) => {
                        // Prevent paste
                        e.preventDefault();
                      }}
                      onCut={(e) => {
                        // Prevent cut
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        // Prevent drag and drop
                        e.preventDefault();
                      }}
                      onDragOver={(e) => {
                        // Prevent drag over
                        e.preventDefault();
                      }}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      disabled={selectedEquations.length >= 5}
                    />
                  )}
                </div>
              </div>
              {(equationError && !isEquationInputFocused) ? (
                <p className="text-xs text-red-600 mt-1 font-medium">
                  {equationError}
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  Use PRICE and SIZE as variables. Operators: +, -, *, /, ^. Parentheses auto-created.
                </p>
              )}
            </div>

            {/* Date Range */}
            <div className="relative">
              <label className="block text-xs font-semibold mb-1 text-gray-600">Date Range</label>
              <div className="flex gap-2">
                <div className="relative">
                  <DatePicker
                    selected={dateRange[0]}
                    onChange={(date: Date | null) => {
                      if (date) {
                        const minDate = new Date('2015-07-01');
                        if (date < minDate) {
                          setDateRange([minDate, dateRange[1]]);
                        } else {
                          setDateRange([date, dateRange[1]]);
                        }
                      } else {
                        setDateRange([date, dateRange[1]]);
                      }
                    }}
                    openToDate={dateRange[0] || new Date('2015-07-01')}
                    placeholderText="Start Date"
                    className="border border-gray-300 rounded p-2 w-34.5 h-[40px] text-sm focus:ring-2 focus:ring-blue-200 outline-none"
                    dateFormat="yyyy-MM-dd"
                    minDate={new Date('2015-07-01')}
                    maxDate={dateRange[1] ? dateRange[1] : new Date()}
                    showYearDropdown
                    showMonthDropdown
                    useShortMonthInDropdown
                    dropdownMode="select"
                    yearDropdownItemNumber={15}
                    scrollableYearDropdown
                    scrollableMonthYearDropdown
                    popperPlacement="bottom"
                    preventOpenOnFocus={false}
                    shouldCloseOnSelect={true}
                  />
                </div>
                <span className="self-center">-</span>
                <div className="relative">
                  <DatePicker
                    selected={dateRange[1]}
                    onChange={(date: Date | null) => setDateRange([dateRange[0], date])}
                    openToDate={dateRange[1] || new Date()}
                    placeholderText="End Date"
                    className="border border-gray-300 rounded p-2 w-34.5 h-[40px] text-sm focus:ring-2 focus:ring-blue-200 outline-none"
                    dateFormat="yyyy-MM-dd"
                    minDate={dateRange[0] ? dateRange[0] : new Date('2015-07-01')}
                    maxDate={new Date()}
                    showYearDropdown
                    showMonthDropdown
                    useShortMonthInDropdown
                    dropdownMode="select"
                    yearDropdownItemNumber={15}
                    scrollableYearDropdown
                    scrollableMonthYearDropdown
                    popperPlacement="bottom"
                    preventOpenOnFocus={false}
                    shouldCloseOnSelect={true}
                  />
                </div>
              </div>
            </div>

            {/* Price Range */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-600">Price Range</label>
              <div className="flex gap-2">
                <input 
                  type="number" 
                  className="border border-gray-300 rounded p-2 w-1/2 h-[40px] text-sm font-mono focus:ring-2 focus:ring-blue-200 outline-none" 
                  value={priceRange[0] ?? ''} 
                  onChange={e => {
                    const value = e.target.value;
                    const newMin = value === '' ? null : Math.max(0, +value);
                    if (newMin !== null && priceRange[1] !== null && newMin > priceRange[1]) {
                      setPriceRange([newMin, newMin]);
                    } else {
                      setPriceRange([newMin, priceRange[1]]);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const currentVal = priceRange[0] ?? 0;
                      let newVal;
                      if (currentVal === 0.0001) {
                        newVal = 1;
                      } else if (currentVal % 1 !== 0) {
                        newVal = Math.ceil(currentVal);
                      } else {
                        newVal = currentVal + 1;
                      }
                      if (priceRange[1] !== null && newVal > priceRange[1]) {
                        setPriceRange([newVal, newVal]);
                      } else {
                        setPriceRange([newVal, priceRange[1]]);
                      }
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const currentVal = priceRange[0] ?? 0;
                      let newVal;
                      if (currentVal === 1) {
                        newVal = 0.0001;
                      } else if (currentVal % 1 !== 0) {
                        newVal = Math.ceil(currentVal);
                      } else {
                        newVal = Math.max(0.0001, currentVal - 1);
                      }
                      setPriceRange([newVal, priceRange[1]]);
                    }
                  }}
                  placeholder="Min Price"
                  min="0"
                />
                <span className="self-center">-</span>
                <input 
                  type="number" 
                  className="border border-gray-300 rounded p-2 w-1/2 h-[40px] text-sm font-mono focus:ring-2 focus:ring-blue-200 outline-none" 
                  value={priceRange[1] ?? ''} 
                  onChange={e => {
                    const value = e.target.value;
                    const newMax = value === '' ? null : Math.max(0, +value);
                    if (newMax !== null && priceRange[0] !== null && newMax < priceRange[0]) {
                      setPriceRange([newMax, newMax]);
                    } else {
                      setPriceRange([priceRange[0], newMax]);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const currentVal = priceRange[1] ?? 0;
                      let newVal;
                      if (currentVal === 0.0001) {
                        newVal = 1;
                      } else if (currentVal % 1 !== 0) {
                        newVal = Math.ceil(currentVal);
                      } else {
                        newVal = currentVal + 1;
                      }
                      setPriceRange([priceRange[0], newVal]);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const currentVal = priceRange[1] ?? 0;
                      let newVal;
                      if (currentVal === 1) {
                        newVal = 0.0001;
                      } else if (currentVal % 1 !== 0) {
                        newVal = Math.ceil(currentVal);
                      } else {
                        newVal = Math.max(0.0001, currentVal - 1);
                      }
                      if (priceRange[0] !== null && newVal < priceRange[0]) {
                        setPriceRange([newVal, newVal]);
                      } else {
                        setPriceRange([priceRange[0], newVal]);
                      }
                    }
                  }}
                  placeholder="Max Price"
                  min="0"
                />
              </div>
            </div>

            {/* Volume Range */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-600">Size Range</label>
              <div className="flex gap-2">
                <input 
                  type="number" 
                  className="border border-gray-300 rounded p-2 w-1/2 h-[40px] text-sm font-mono focus:ring-2 focus:ring-blue-200 outline-none" 
                  value={volumeRange[0] ?? ''} 
                  onChange={e => {
                    const value = e.target.value;
                    let newMin = value === '' ? null : Math.max(0, +value);
                    if (newMin !== null && newMin % 1 !== 0) {
                      newMin = Math.ceil(newMin);
                    }
                    if (newMin !== null && volumeRange[1] !== null && newMin > volumeRange[1]) {
                      setVolumeRange([newMin, newMin]);
                    } else {
                      setVolumeRange([newMin, volumeRange[1]]);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const currentVal = volumeRange[0] ?? 0;
                      const newVal = currentVal + 1;
                      if (volumeRange[1] !== null && newVal > volumeRange[1]) {
                        setVolumeRange([newVal, newVal]);
                      } else {
                        setVolumeRange([newVal, volumeRange[1]]);
                      }
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const currentVal = volumeRange[0] ?? 0;
                      const newVal = Math.max(0, currentVal - 1);
                      setVolumeRange([newVal, volumeRange[1]]);
                    }
                  }}
                  placeholder="Min Size"
                  min="0"
                />
                <span className="self-center">-</span>
                <input 
                  type="number" 
                  className="border border-gray-300 rounded p-2 w-1/2 h-[40px] text-sm font-mono focus:ring-2 focus:ring-blue-200 outline-none" 
                  value={volumeRange[1] ?? ''} 
                  onChange={e => {
                    const value = e.target.value;
                    let newMax = value === '' ? null : Math.max(0, +value);
                    if (newMax !== null && newMax % 1 !== 0) {
                      newMax = Math.ceil(newMax);
                    }
                    if (newMax !== null && volumeRange[0] !== null && newMax < volumeRange[0]) {
                      setVolumeRange([newMax, newMax]);
                    } else {
                      setVolumeRange([volumeRange[0], newMax]);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const currentVal = volumeRange[1] ?? 0;
                      const newVal = currentVal + 1;
                      setVolumeRange([volumeRange[0], newVal]);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const currentVal = volumeRange[1] ?? 0;
                      const newVal = Math.max(0, currentVal - 1);
                      if (volumeRange[0] !== null && newVal < volumeRange[0]) {
                        setVolumeRange([newVal, newVal]);
                      } else {
                        setVolumeRange([volumeRange[0], newVal]);
                      }
                    }
                  }}
                  placeholder="Max Size"
                  min="0"
                />
              </div>
            </div>

            {/* Sort By / Aggregate By */}
            {/* ----modified---- */}
            {selectedEquations.length === 0 ? (
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600">Sort By</label>
                <select 
                  className="border border-gray-300 rounded w-full h-[40px] p-2 text-sm focus:ring-2 focus:ring-blue-200 outline-none" 
                  value={sortBy} 
                  onChange={e => setSortBy(e.target.value)}
                >
                  {Object.entries(SORT_OPTIONS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600">Aggregate By</label>
                <select 
                  className="border border-gray-300 rounded w-full h-[40px] p-2 text-sm focus:ring-2 focus:ring-blue-200 outline-none" 
                  value={aggregateBy} 
                  onChange={e => setAggregateBy(e.target.value)}
                >
                  {Object.entries(AGGREGATE_OPTIONS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            )}
            {/* ----modified---- */}
          </div>
        </div>

        {/* Export CSV Button */}
        <div className="mb-8 flex gap-3">
          <button 
            className="border border-blue-600 text-blue-600 bg-white px-6 py-2 rounded-md font-medium hover:bg-blue-600 hover:text-white focus:ring-2 focus:ring-blue-200 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer" 
            onClick={handleDownloadCSV}
            disabled={isDownloading}
          >
            {isDownloading ? 'Exporting...' : 'Export CSV'}
          </button>
          <button 
            className="border border-gray-600 text-gray-600 bg-white px-6 py-2 rounded-md font-medium hover:bg-gray-600 hover:text-white focus:ring-2 focus:ring-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer" 
            onClick={handleResetFilters}
            disabled={isDownloading}
          >
            Reset Filters
          </button>
        </div>
      </main>

      {/* Export Popup Modal */}
      {showExportPopup && (
        <div 
          className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowExportPopup(false)}
        >
          <div 
            className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Export Options</h3>
            <p className="text-gray-600 mb-6">Would you like to reset the filters after exporting?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExportPopup(false)}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold w-[65px]"
              >
                Cancel
              </button>
              <button
                onClick={handleExportWithReset}
                className="px-4 py-2 text-blue-600 bg-blue-100 rounded-lg hover:bg-blue-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold w-[65px]"
                disabled={isDownloading}
              >
                Yes
              </button>
              <button
                onClick={handleExportWithoutReset}
                className="px-4 py-2 text-blue-600 bg-blue-100 rounded-lg hover:bg-blue-200 transition disabled:opacity-50 cursor-pointer text-xs font-semibold w-[65px]"
                disabled={isDownloading}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}