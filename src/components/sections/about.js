import React, { useEffect, useRef } from 'react';
import { StaticImage } from 'gatsby-plugin-image';
import styled from 'styled-components';
import { srConfig } from '@config';
import sr from '@utils/sr';
import { usePrefersReducedMotion } from '@hooks';

const StyledAboutSection = styled.section`
  max-width: 900px;

  .inner {
    display: grid;
    grid-template-columns: 3fr 2fr;
    grid-gap: 50px;

    @media (max-width: 768px) {
      display: block;
    }
  }
`;
const StyledText = styled.div`
  ul.skills-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(140px, 200px));
    grid-gap: 0 10px;
    padding: 0;
    margin: 20px 0 0 0;
    overflow: hidden;
    list-style: none;

    li {
      position: relative;
      margin-bottom: 10px;
      padding-left: 20px;
      font-family: var(--font-mono);
      font-size: var(--fz-xs);

      &:before {
        content: '▹';
        position: absolute;
        left: 0;
        color: var(--green);
        font-size: var(--fz-sm);
        line-height: 12px;
      }
    }
  }
`;
const StyledPic = styled.div`
  position: relative;
  max-width: 300px;

  @media (max-width: 768px) {
    margin: 50px auto 0;
    width: 70%;
  }

  .wrapper {
    ${({ theme }) => theme.mixins.boxShadow};
    display: block;
    position: relative;
    width: 100%;
    border-radius: var(--border-radius);
    background-color: var(--green);

    &:hover,
    &:focus {
      outline: 0;
      transform: translate(-4px, -4px);

      &:after {
        transform: translate(8px, 8px);
      }

      .img {
        filter: none;
        mix-blend-mode: normal;
      }
    }

    .img {
      position: relative;
      border-radius: var(--border-radius);
      mix-blend-mode: multiply;
      filter: grayscale(100%) contrast(1);
      transition: var(--transition);
    }

    &:before,
    &:after {
      content: '';
      display: block;
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: var(--border-radius);
      transition: var(--transition);
    }

    &:before {
      top: 0;
      left: 0;
      background-color: var(--navy);
      mix-blend-mode: screen;
    }

    &:after {
      border: 2px solid var(--green);
      top: 14px;
      left: 14px;
      z-index: -1;
    }
  }
`;

const About = () => {
  const revealContainer = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    sr.reveal(revealContainer.current, srConfig());
  }, []);

  const skills = [
    'Apache Spark (v2 & 3)',
    'Scala',
    'Python',
    'Sql Server',
    'Trino/Starburst',
    'Talend',
    'Ansible',
    'Terraform',
    'Azure Data Factory',
    'Azure Synapse Analytics',
    'Azure Databricks',
    'Azure Key Vault',
    'Azure Storage Datalake',
    'AWS Glue',
    'AWS S3',
    'AWS EMR',
  ];

  return (
    <StyledAboutSection id="about" ref={revealContainer}>
      <h2 className="numbered-heading">About Me</h2>

      <div className="inner">
        <StyledText>
          <div>
            <p>
              J'accumule de plus de 5 années d'expérience, dont 2 années en tant que{' '}
              <a href="*">Software Engineer</a>, impliqué dans le développement de services de suivi
              des facturations et des coûts des licences pour le <a href="*">Middleware</a>.
            </p>
            <p>
              Les 3 années suivantes ont été consacrées à la fonction de{' '}
              <a href="*">Data Engineer</a>, spécialisé dans la migration de Datalake de{' '}
              <a href="*">Hortonworks</a> vers <a href="*">Cloudera</a>, la transformation de jobs{' '}
              <a href="*">Talend en Scala/Spark</a>, et l'accélération analytique grâce à la mise en
              place de <a href="*">Trino/Starburst</a>.
            </p>
            <p>
              Enfin, j'ai exercé 2 années en tant que <a href="*">Tech Lead</a> et{' '}
              <a href="*">Chapter Leader</a> dans la communauté Big Data.
            </p>

            <p>
              Remontons rapidement à aujourd'hui, Je suis passioné de travailler sur des modernes
              data stack{' '}
              <a href="https://www.databricks.com/product/data-lakehouse">
                Data lakehouse de Databricks
              </a>
              , <a href="https://azure.microsoft.com/fr-fr/products/cloud-services/">Azure Cloud</a>
              , <a href="https://aws.amazon.com/fr/">Aws Cloud</a>, et{' '}
              <a href="https://www.starburst.io/">Starburst - Modern Data Analytics</a>. Je m'engage
              dans l'optimisation des données, en élaborant des stratégies visant à améliorer leur
              qualité, leur accessibilité et leur performance à{' '}
              <a href="https://talan.com/">Talan</a> pour ses clients.
            </p>

            {/* <p>
              I also recently{' '}
              <a href="https://www.newline.co/courses/build-a-spotify-connected-app">
                launched a course
              </a>{' '}
              that covers everything you need to build a web app with the Spotify API using Node
              &amp; React.
            </p> */}

            <p>Voici quelques technologies avec lesquelles j'ai récemment travaillé :</p>
          </div>

          <ul className="skills-list">
            {skills && skills.map((skill, i) => <li key={i}>{skill}</li>)}
          </ul>
        </StyledText>

        <StyledPic>
          <div className="wrapper">
            <StaticImage
              className="img"
              src="../../images/me.jpeg"
              width={500}
              quality={95}
              formats={['AUTO', 'WEBP', 'AVIF']}
              alt="Headshot"
            />
          </div>
        </StyledPic>
      </div>
    </StyledAboutSection>
  );
};

export default About;
