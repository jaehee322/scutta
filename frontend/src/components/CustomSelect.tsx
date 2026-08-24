import { Check, ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type CustomSelectValue = string | number;

export type CustomSelectOption<T extends CustomSelectValue> = Readonly<{
  value: T;
  label: string;
  disabled?: boolean;
}>;

export type CustomSelectProps<T extends CustomSelectValue> = {
  value: T | null;
  options: readonly CustomSelectOption<T>[];
  onChange: (value: T) => void;
  label?: ReactNode;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
};

type MenuPosition = {
  placement: "up" | "down";
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const VIEWPORT_MARGIN = 12;
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 288;

function findEnabledIndex<T extends CustomSelectValue>(
  options: readonly CustomSelectOption<T>[],
  startIndex: number,
  direction: 1 | -1,
) {
  for (
    let index = startIndex;
    index >= 0 && index < options.length;
    index += direction
  ) {
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function CustomSelect<T extends CustomSelectValue>({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  ariaDescribedBy,
  placeholder = "선택해주세요",
  disabled = false,
  required = false,
  id,
  name,
  className = "",
}: CustomSelectProps<T>) {
  const generatedId = useId();
  const triggerId = id ?? `custom-select-${generatedId}`;
  const labelId = `${triggerId}-label`;
  const listboxId = `${triggerId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const typeaheadBufferRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => Object.is(option.value, value)),
    [options, value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const firstEnabledIndex = findEnabledIndex(options, 0, 1);
  const lastEnabledIndex = findEnabledIndex(options, options.length - 1, -1);

  const optionId = useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId],
  );

  const restoreTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current);
      typeaheadTimerRef.current = null;
    }
    typeaheadBufferRef.current = "";
    setIsOpen(false);
    setMenuPosition(null);
    if (restoreFocus) restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const openMenu = useCallback((edge?: "first" | "last") => {
    if (disabled || !options.length) return;
    const selectedIsEnabled = selectedIndex >= 0 && !options[selectedIndex].disabled;
    const nextActiveIndex = edge === "first"
      ? firstEnabledIndex
      : edge === "last"
        ? lastEnabledIndex
        : selectedIsEnabled
          ? selectedIndex
          : firstEnabledIndex;
    setActiveIndex(nextActiveIndex);
    setIsOpen(true);
  }, [disabled, firstEnabledIndex, lastEnabledIndex, options, selectedIndex]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (rect.bottom < 0 || rect.top > viewportHeight) {
      closeMenu(false);
      return;
    }

    const availableBelow = Math.max(
      0,
      viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN,
    );
    const availableAbove = Math.max(0, rect.top - MENU_GAP - VIEWPORT_MARGIN);
    const estimatedHeight = Math.min(options.length * 46 + 12, MENU_MAX_HEIGHT);
    const placement = availableBelow < Math.min(estimatedHeight, 160)
      && availableAbove > availableBelow
      ? "up"
      : "down";
    const availableHeight = placement === "up" ? availableAbove : availableBelow;
    const availableWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
    const width = Math.min(Math.max(rect.width, 180), availableWidth);
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width),
    );

    setMenuPosition({
      placement,
      left,
      width,
      maxHeight: Math.min(MENU_MAX_HEIGHT, availableHeight),
      ...(placement === "up"
        ? { bottom: viewportHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
    });
  }, [closeMenu, options.length]);

  useLayoutEffect(() => {
    if (isOpen) updateMenuPosition();
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;

    let animationFrame = 0;
    const schedulePositionUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateMenuPosition);
    };
    const resizeObserver = new ResizeObserver(schedulePositionUpdate);
    if (triggerRef.current) resizeObserver.observe(triggerRef.current);

    window.addEventListener("resize", schedulePositionUpdate);
    document.addEventListener("scroll", schedulePositionUpdate, true);
    window.visualViewport?.addEventListener("resize", schedulePositionUpdate);
    window.visualViewport?.addEventListener("scroll", schedulePositionUpdate);
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedulePositionUpdate);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      window.visualViewport?.removeEventListener("resize", schedulePositionUpdate);
      window.visualViewport?.removeEventListener("scroll", schedulePositionUpdate);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target)
        && !listboxRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [closeMenu, isOpen]);

  useEffect(() => {
    if (disabled && isOpen) closeMenu(false);
  }, [closeMenu, disabled, isOpen]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const listbox = listboxRef.current;
    const activeOption = listbox?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    if (!listbox || !activeOption) return;

    const optionTop = activeOption.offsetTop;
    const optionBottom = optionTop + activeOption.offsetHeight;
    if (optionTop < listbox.scrollTop) listbox.scrollTop = optionTop;
    else if (optionBottom > listbox.scrollTop + listbox.clientHeight) {
      listbox.scrollTop = optionBottom - listbox.clientHeight;
    }
  }, [activeIndex, isOpen]);

  const moveActiveOption = (direction: 1 | -1) => {
    const startIndex = activeIndex < 0
      ? direction === 1 ? 0 : options.length - 1
      : activeIndex + direction;
    const nextIndex = findEnabledIndex(options, startIndex, direction);
    if (nextIndex >= 0) setActiveIndex(nextIndex);
  };

  const commitOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (!Object.is(option.value, value)) onChange(option.value);
    closeMenu(true);
  };

  const moveByTypeahead = (key: string) => {
    const normalizedKey = key.normalize("NFC").toLocaleLowerCase("ko-KR");
    const previousBuffer = typeaheadBufferRef.current;
    const isRepeatedCharacter = previousBuffer.length > 0
      && [...previousBuffer].every((character) => character === normalizedKey);
    const searchText = isRepeatedCharacter
      ? normalizedKey
      : `${previousBuffer}${normalizedKey}`;
    typeaheadBufferRef.current = searchText;
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current);
    }
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadBufferRef.current = "";
      typeaheadTimerRef.current = null;
    }, 650);

    const startIndex = isRepeatedCharacter && activeIndex >= 0
      ? activeIndex + 1
      : 0;
    const orderedIndexes = Array.from(
      { length: options.length },
      (_, offset) => (startIndex + offset) % options.length,
    );
    const matchingIndex = orderedIndexes.find((index) => {
      const option = options[index];
      return !option.disabled
        && option.label.normalize("NFC").toLocaleLowerCase("ko-KR").startsWith(searchText);
    });
    if (matchingIndex === undefined) return;
    setActiveIndex(matchingIndex);
    if (!isOpen) setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const isTypeaheadKey = event.key.length === 1
      && event.key !== " "
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey;
    if (isTypeaheadKey) {
      event.preventDefault();
      moveByTypeahead(event.key);
      return;
    }
    if (!isOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        openMenu(event.key === "Home" ? "first" : "last");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? firstEnabledIndex : lastEnabledIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0) commitOption(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu(false);
    }
  };

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        left: menuPosition.left,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
        top: menuPosition.top,
        bottom: menuPosition.bottom,
      }
    : undefined;
  const accessibleLabelProps = ariaLabel
    ? { "aria-label": ariaLabel }
    : label
      ? { "aria-labelledby": `${labelId} ${triggerId}` }
      : { "aria-label": placeholder };

  return (
    <div className={`custom-select-field ${className}`.trim()} ref={rootRef}>
      {label && <span className="custom-select__label" id={labelId}>{label}</span>}
      <div className="custom-select">
        {name && (
          <input
            type="hidden"
            name={name}
            value={value === null ? "" : String(value)}
            disabled={disabled}
          />
        )}
        <button
          {...accessibleLabelProps}
          ref={triggerRef}
          id={triggerId}
          className="custom-select__trigger"
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={ariaDescribedBy}
          aria-required={required || undefined}
          aria-invalid={required && value === null ? true : undefined}
          disabled={disabled}
          onClick={() => isOpen ? closeMenu(false) : openMenu()}
          onKeyDown={handleKeyDown}
        >
          <span className={`custom-select__value ${selectedOption ? "" : "custom-select__value--placeholder"}`.trim()}>
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="custom-select__chevron" size={19} aria-hidden="true" />
        </button>
      </div>
      {isOpen && menuPosition && createPortal(
        <div
          className="custom-select__menu"
          data-placement={menuPosition.placement}
          style={menuStyle}
        >
          <ul
            ref={listboxRef}
            id={listboxId}
            className="custom-select__list"
            role="listbox"
            aria-labelledby={label ? labelId : undefined}
            aria-label={!label ? (ariaLabel ?? placeholder) : undefined}
          >
            {options.map((option, index) => {
              const isSelected = Object.is(option.value, value);
              const isActive = index === activeIndex;
              return (
                <li
                  key={`${typeof option.value}-${String(option.value)}`}
                  id={optionId(index)}
                  className="custom-select__option"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-active={isActive || undefined}
                  data-option-index={index}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => commitOption(index)}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check size={17} aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
