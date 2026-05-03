import { useState, useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { BrowserMockup, AnimatedCaption } from '../ui/Mockups';
import mapImg from '@assets/screenshots/03-map.jpg';

export function Scene5() {
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(1240);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 2000), // start counting
      setTimeout(() => setPhase(3), 9000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  useEffect(() => {
    if (phase >= 2 && phase < 3) {
      const interval = setInterval(() => {
        setCount(c => c + Math.floor(Math.random() * 5) + 1);
      }, 150);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [phase]);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8 }}
    >
      <div className="w-[85vw] h-[75vh] relative">
        <BrowserMockup className="w-full h-full bg-[#1A2E35]">
          <div className="relative w-full h-full overflow-hidden">
            <motion.img 
              src={mapImg} 
              className="absolute inset-0 w-full h-full object-cover object-center"
              animate={{ scale: [1, 1.1], x: [0, -20], y: [0, 10] }}
              transition={{ duration: 10, ease: "linear" }}
            />
            
            {/* Live Ticker Overlay */}
            <motion.div 
              className="absolute top-12 left-12 bg-white/90 backdrop-blur-md p-6 rounded-xl shadow-2xl border border-white/20 flex flex-col gap-2"
              initial={{ opacity: 0, x: -30 }}
              animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
              transition={{ duration: 0.8, delay: 0.5 }}
            >
              <div className="text-[1vw] text-[#4A5B63] font-medium uppercase tracking-wider">Live Network</div>
              <div className="text-[3vw] font-mono font-bold text-[#1A2E35] flex items-center gap-4">
                {count.toLocaleString()}
                <motion.div 
                  className="w-3 h-3 bg-[#2E6F40] rounded-full"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <div className="text-[1.2vw] text-[#8E9B9F]">defenses mapped</div>
            </motion.div>
          </div>
        </BrowserMockup>
      </div>

      <AnimatedCaption text="Every upload is pinned — anonymously — so the next person walks in already winning." phase={phase >= 1 ? 1 : 0} />
    </motion.div>
  );
}
