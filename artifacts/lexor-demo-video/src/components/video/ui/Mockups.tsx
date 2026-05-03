import { ReactNode } from 'react';
import { motion } from 'framer-motion';

export function BrowserMockup({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <div className={`browser-mockup bg-white rounded-xl overflow-hidden flex flex-col ${className}`}>
      <div className="h-8 bg-[#F7F5F0] border-b border-[#EBE7DF] flex items-center px-4 gap-2 shrink-0">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#C14A3D]/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#D9A05B]/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#2E6F40]/80" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}

export function PhoneMockup({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <div className={`phone-mockup bg-white rounded-[2rem] overflow-hidden flex flex-col relative ${className}`}>
      <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-20 pointer-events-none">
        <div className="w-1/3 h-4 bg-[#1A2E35] rounded-b-xl" />
      </div>
      <div className="flex-1 overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}

export function AnimatedCaption({ text, phase, delay = 0 }: { text: string, phase: number, delay?: number }) {
  return (
    <div className="absolute bottom-[10vh] inset-x-0 flex justify-center z-50 pointer-events-none">
      <motion.div 
        className="bg-[#1A2E35] text-[#F7F5F0] px-8 py-4 rounded-full shadow-2xl max-w-[80vw] text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={phase > 0 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay }}
      >
        <h2 className="text-[2.5vw] font-medium tracking-tight font-display" style={{ fontFamily: 'var(--font-display)' }}>
          {text}
        </h2>
      </motion.div>
    </div>
  );
}
