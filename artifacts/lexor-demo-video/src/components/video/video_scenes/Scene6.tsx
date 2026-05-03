import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BrowserMockup, PhoneMockup, AnimatedCaption } from '../ui/Mockups';
import voiceImg from '@assets/screenshots/04-voice.jpg';
import mobileImg from '@assets/screenshots/07-mobile-landing.jpg';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 9000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center gap-12"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="w-[45vw] h-[65vh]"
        initial={{ opacity: 0, x: -30, rotateY: 15 }}
        animate={phase >= 1 ? { opacity: 1, x: 0, rotateY: 0 } : { opacity: 0, x: -30, rotateY: 15 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: '1000px' }}
      >
        <BrowserMockup className="w-full h-full">
          <motion.img 
            src={voiceImg} 
            className="w-full h-full object-cover object-left-top"
            animate={{ scale: [1, 1.05] }}
            transition={{ duration: 10, ease: 'linear' }}
          />
        </BrowserMockup>
      </motion.div>

      <motion.div 
        className="w-[20vw] h-[75vh]"
        initial={{ opacity: 0, x: 30, rotateY: -15 }}
        animate={phase >= 1 ? { opacity: 1, x: 0, rotateY: 0 } : { opacity: 0, x: 30, rotateY: -15 }}
        transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: '1000px' }}
      >
        <PhoneMockup className="w-full h-full">
          <motion.img 
            src={mobileImg} 
            className="w-full h-full object-cover object-top"
            animate={{ y: [0, -100] }}
            transition={{ duration: 10, ease: 'linear' }}
          />
        </PhoneMockup>
      </motion.div>

      <AnimatedCaption text="Speaks any language by phone or WhatsApp. No account, no app, no English required." phase={phase >= 1 ? 1 : 0} />
    </motion.div>
  );
}
