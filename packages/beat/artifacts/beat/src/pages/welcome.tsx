import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Shield, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Welcome() {
  const [, navigate] = useLocation();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: "linear-gradient(160deg, #0A0F0C 0%, #0D1810 60%, #0A0F0C 100%)" }}
      data-testid="welcome-screen"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="flex flex-col items-center gap-8 max-w-sm w-full text-center"
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="relative"
        >
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(0,255,136,0.08)",
              border: "1px solid rgba(0,255,136,0.3)",
              boxShadow: "0 0 40px rgba(0,255,136,0.15)",
            }}
          >
            <Shield className="w-10 h-10 text-primary" />
          </div>
        </motion.div>

        <div className="space-y-3">
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-4xl font-bold tracking-tight text-foreground"
          >
            Beat
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="text-sm text-muted-foreground leading-relaxed"
          >
            Detective Field Kit
            <br />
            Multi-agent investigation intelligence
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          className="w-full space-y-3"
        >
          <Button
            onClick={() => navigate("/sign-in")}
            className="w-full h-12 text-sm font-semibold tracking-wide gap-2"
            style={{
              background: "#00FF88",
              color: "#0A0F0C",
              boxShadow: "0 0 20px rgba(0,255,136,0.3)",
            }}
            data-testid="button-sign-in"
          >
            <LogIn className="w-4 h-4" />
            Sign In
          </Button>
          <Button
            onClick={() => navigate("/sign-up")}
            variant="outline"
            className="w-full h-12 text-sm font-semibold tracking-wide gap-2"
            style={{
              borderColor: "rgba(0,255,136,0.3)",
              color: "#00FF88",
              background: "rgba(0,255,136,0.05)",
            }}
            data-testid="button-sign-up"
          >
            <UserPlus className="w-4 h-4" />
            Create Account
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Not for evidentiary use
          </p>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        transition={{ delay: 1, duration: 1 }}
        className="absolute bottom-8 left-0 right-0 text-center text-[10px] font-mono text-muted-foreground tracking-widest uppercase"
      >
        Powered by Anthropic · Gemini · OpenAI · E2B · Tavily
      </motion.div>
    </div>
  );
}
