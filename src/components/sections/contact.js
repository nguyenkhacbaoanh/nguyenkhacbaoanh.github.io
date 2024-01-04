import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { srConfig, email } from '@config';
import sr from '@utils/sr';
import { usePrefersReducedMotion } from '@hooks';

const StyledContactSection = styled.section`
  max-width: 600px;
  margin: 0 auto 100px;
  text-align: center;

  @media (max-width: 768px) {
    margin: 0 auto 50px;
  }

  .overline {
    display: block;
    margin-bottom: 20px;
    color: var(--green);
    font-family: var(--font-mono);
    font-size: var(--fz-md);
    font-weight: 400;

    &:before {
      bottom: 0;
      font-size: var(--fz-sm);
    }

    &:after {
      display: none;
    }
  }

  .title {
    font-size: clamp(40px, 5vw, 60px);
  }

  .email-link {
    ${({ theme }) => theme.mixins.bigButton};
    margin-top: 50px;
  }
`;

const Contact = () => {
  const revealContainer = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    sr.reveal(revealContainer.current, srConfig());
  }, []);

  return (
    <StyledContactSection id="contact" ref={revealContainer}>
      <h2 className="numbered-heading overline">Prochaine étape ?</h2>

      <h2 className="title">Garde en contact</h2>

      <p>
        Je ne suis pas actuellement en recherche une nouvelle opportunité mais je suis toujours prêt
        d'élargir mes réseaux professionels. Envoyez moi l'invitation sur{' '}
        <a href="https://www.linkedin.com/in/nguyenkhacbaoanh/">Linkedin</a> ou envoyez par mail
        ci-dessous.
      </p>

      <a className="email-link" href={`mailto:${email}`}>
        Envoyez - moi !!!
      </a>
    </StyledContactSection>
  );
};

export default Contact;
