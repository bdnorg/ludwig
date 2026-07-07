export interface MenuItem {
  label: string;
  danger?: boolean;
  run: () => void;
}
