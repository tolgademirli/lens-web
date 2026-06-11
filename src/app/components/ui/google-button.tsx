import { Button } from "./button";
import { GoogleIcon } from "./google-icon";
import { cn } from "./utils";

interface GoogleButtonProps {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export function GoogleButton({ onClick, disabled, label = "Google ile Devam Et", className }: GoogleButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      size="lg"
      className={cn(
        "w-full h-14 bg-white hover:bg-gray-50 text-[#3c4043] border border-gray-300 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
    >
      <GoogleIcon className="w-5 h-5" />
      {label}
    </Button>
  );
}
