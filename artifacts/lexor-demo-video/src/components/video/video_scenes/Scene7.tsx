import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrowserMockup, AnimatedCaption } from '../ui/Mockups';
import disclaimerImg from '@assets/screenshots/06-disclaimer.jpg';
import aboutImg from '@assets/screenshots/05-about.jpg';

export function Scene7() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100), // disclaimer
      setTimeout(() => setPhase(2), 2000), // switch to about
      setTimeout(() => setPhase(3), 4000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.8 }}
    >
      <div className="w-[85vw] h-[75vh] relative">
        <BrowserMockup className="w-full h-full bg-[#F7F5F0]">
          <AnimatePresence mode="wait">
            {phase < 2 ? (
              <motion.img 
                key="disclaimer"
                src={disclaimerImg} 
                className="absolute inset-0 w-full h-full object-cover object-center"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, filter: 'blur(10px)' }}
                transition={{ duration: 0.6 }}
              />
            ) : (
              <motion.img 
                key="about"
                src={aboutImg} 
                className="absolute inset-0 w-full h-full object-cover object-top"
                initial={{ opacity: 0, filter: 'blur(10px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.6 }}
              />
            )}
          </AnimatePresence>
        </BrowserMockup>
      </div>

      <AnimatedCaption text="A self-help tool, not a law firm. Built for the $40 phone in someone's pocket." phase={phase >= 1 ? 1 : 0} />
    </motion.div>
  );
}
