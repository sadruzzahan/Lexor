import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BrowserMockup, AnimatedCaption } from '../ui/Mockups';
import landingImg from '@assets/screenshots/01-landing.jpg';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 4000), // exit start
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="w-[85vw] h-[75vh]"
        initial={{ opacity: 0, y: 40, rotateX: 10 }}
        animate={phase >= 1 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 40, rotateX: 10 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: '1000px' }}
      >
        <BrowserMockup className="w-full h-full">
          <motion.img 
            src={landingImg} 
            className="w-full h-full object-cover object-top"
            animate={{ scale: [1, 1.05] }}
            transition={{ duration: 5, ease: 'linear' }}
          />
        </BrowserMockup>
      </motion.div>

      <AnimatedCaption text="Lexor turns any scary legal letter into a 30-second action plan." phase={phase >= 2 ? 1 : 0} />
    </motion.div>
  );
}
